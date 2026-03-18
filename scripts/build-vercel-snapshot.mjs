import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..')

const SOURCE_DELIVERABLES_DIR = path.resolve(process.env.DELIVERABLES_SOURCE || path.join(WORKSPACE_ROOT, 'deliverables'))
const DEST_ARTIFACTS_ROOT = path.resolve(REPO_ROOT, 'public', 'ff_artifacts')
const DEST_DELIVERABLES_DIR = path.resolve(DEST_ARTIFACTS_ROOT, 'deliverables')

const FF_STATE_DIR = path.resolve(REPO_ROOT, 'public', 'ff_state')
const CLIENTS_FILE = path.resolve(FF_STATE_DIR, 'clients.json')
const OUT_INDEX = path.resolve(FF_STATE_DIR, 'deliverables-index.json')

const TEXT_FILE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.html'])

const DEFAULT_CLIENT_CATALOG = {
  bed_bug_bbq: 'Bed Bug BBQ',
  bed_bugs_be_gone: 'Bed Bugs Be Gone Now',
  heat_tech_bed_bug: 'Heat Tech',
  chapman_plumbing: 'Chapman Plumbing'
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function prettyClientName(slug) {
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function parseWeekNumbers(weekBucket) {
  const match = String(weekBucket).match(/^week(\d{1,2})(?:-(\d{1,2}))?(?:[-_].+)?$/i)
  if (!match) return []
  const start = Math.max(1, Math.min(53, Number(match[1])))
  const end = Math.max(1, Math.min(53, Number(match[2] ?? match[1])))
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

function dateFromName(name) {
  const match = String(name).match(/^(\d{4}-\d{2}-\d{2})_/)
  if (!match) return null
  return match[1]
}

function classifyWorkflow(name, relativePath, artifactType) {
  const lower = `${relativePath}/${name}`.toLowerCase()
  const type = String(artifactType || '').toLowerCase()

  if (type === 'research' || lower.includes('research-pack') || lower.includes('_research')) return 'research'
  if (lower.includes('_draft') || lower.includes('-draft') || lower.includes('draft_')) return 'draft'
  if (lower.includes('_qc') || lower.includes('quality-check') || lower.includes('quality_check')) return 'qc'
  return 'other'
}

function classifyContentCategory(name, relativePath, artifactType, workflow) {
  const full = `${relativePath}/${name}`.toLowerCase()
  const type = String(artifactType || '').toLowerCase()

  const link1 = /(^|[^a-z0-9])(link[_-]?1|l1)([^a-z0-9]|$)/i
  const link2 = /(^|[^a-z0-9])(link[_-]?2|l2)([^a-z0-9]|$)/i
  const link3 = /(^|[^a-z0-9])(link[_-]?3|l3)([^a-z0-9]|$)/i

  if (link1.test(full)) return 'l1'
  if (link2.test(full)) return 'l2'
  if (link3.test(full)) return 'l3'
  if (workflow === 'qc' || full.includes('quality-check') || full.includes('quality_check')) return 'qc'
  if (full.includes('gmb') || full.includes('gbp') || full.includes('gpp') || type === 'gbp_post' || type === 'gpp_post') return 'gmb'
  if (workflow === 'research' || type === 'research') return 'research'
  if (workflow === 'draft' || type === 'blog_post') return 'blog'
  return 'other'
}

function classifyLevel(category) {
  if (category === 'l1') return 'L1'
  if (category === 'l2') return 'L2'
  if (category === 'l3') return 'L3'
  return 'OTHER'
}

function readClientNames() {
  const names = {}
  try {
    const raw = fs.readFileSync(CLIENTS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    for (const entry of parsed.clients ?? []) {
      const slug = cleanSlug(entry.slug)
      if (!slug) continue
      names[slug] = String(entry.name || '').trim() || prettyClientName(slug)
    }
  } catch {
    // Ignore invalid/missing clients file.
  }
  return names
}

function asInt(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}

function readPlannerTotalsByClient() {
  const totalsByClient = new Map()
  if (!fs.existsSync(FF_STATE_DIR)) return totalsByClient

  const weekStateFiles = fs
    .readdirSync(FF_STATE_DIR)
    .filter((name) => /^week\d+\.json$/i.test(name))
    .sort()

  for (const stateName of weekStateFiles) {
    try {
      const raw = fs.readFileSync(path.join(FF_STATE_DIR, stateName), 'utf8')
      const parsed = JSON.parse(raw)
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
      for (const task of tasks) {
        const slug = cleanSlug(task.client_slug)
        if (!slug) continue
        const slot =
          totalsByClient.get(slug) ?? {
            ordersCreated: 0,
            blogsCreated: 0,
            gpp: 0,
            l1: 0,
            l2: 0,
            l3: 0
          }
        const type = String(task.type ?? '')
        if (type === 'human_order') {
          slot.ordersCreated += 1
        }
        if (type === 'plan_artifact' && task.deliverables && typeof task.deliverables === 'object') {
          const deliverables = task.deliverables
          slot.blogsCreated += asInt(deliverables.blog_post, 0)
          slot.gpp += asInt(deliverables.gpp_post, 0) + asInt(deliverables.gbp_post, 0)
          slot.l1 += asInt(deliverables.link_1, 0)
          slot.l2 += asInt(deliverables.link_2, 0)
          slot.l3 += asInt(deliverables.link_3, 0)
        }
        totalsByClient.set(slug, slot)
      }
    } catch {
      // Ignore invalid/missing week state files.
    }
  }

  return totalsByClient
}

function rmrf(targetPath) {
  if (!fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function copyTextTree(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Missing deliverables source folder: ${srcDir}`)
  }
  fs.mkdirSync(dstDir, { recursive: true })
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name)
    const dst = path.join(dstDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '_reports') continue
      copyTextTree(src, dst)
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name === '.DS_Store') continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!TEXT_FILE_EXTENSIONS.has(ext)) continue
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

function buildDeliverablesIndexFromCopiedTree() {
  const loadedClientNames = readClientNames()
  const clientNames = Object.keys(loadedClientNames).length > 0 ? loadedClientNames : DEFAULT_CLIENT_CATALOG
  const allowedClientSlugs = new Set(Object.keys(clientNames))
  const plannerTotalsByClient = readPlannerTotalsByClient()

  const summaries = new Map()
  const weekBuckets = new Set()
  const artifacts = []

  if (!fs.existsSync(DEST_DELIVERABLES_DIR)) {
    return { ok: true, generatedAt: new Date().toISOString(), weeks: [], clients: [], artifacts: [] }
  }

  const stack = [DEST_DELIVERABLES_DIR]
  while (stack.length) {
    const dir = stack.pop()
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name === '.DS_Store') continue

      const ext = path.extname(entry.name).toLowerCase()
      if (!TEXT_FILE_EXTENSIONS.has(ext)) continue

      const relFromArtifacts = path.relative(DEST_ARTIFACTS_ROOT, abs).split(path.sep).join('/')
      // Expect: deliverables/<weekBucket>/<clientSlug>/<artifactType>/...
      const parts = relFromArtifacts.split('/').filter(Boolean)
      if (parts[0] !== 'deliverables') continue
      const weekBucket = parts[1]
      const clientSlug = cleanSlug(parts[2])
      const artifactType = String(parts[3] ?? '')
      if (!weekBucket || !clientSlug || !artifactType) continue
      if (clientSlug.startsWith('_')) continue
      if (!allowedClientSlugs.has(clientSlug)) continue

      const stat = fs.statSync(abs)
      const modifiedAt = stat.mtime.toISOString()
      const date = dateFromName(entry.name)
      const weekNumbers = parseWeekNumbers(weekBucket)
      const relativePath = relFromArtifacts // relative to /ff_artifacts
      const workflow = classifyWorkflow(entry.name, relativePath, artifactType)
      const contentCategory = classifyContentCategory(entry.name, relativePath, artifactType, workflow)
      const level = classifyLevel(contentCategory)

      const summary =
        summaries.get(clientSlug) ??
        {
          slug: clientSlug,
          name: clientNames[clientSlug] ?? prettyClientName(clientSlug),
          ordersCreated: 0,
          blogsCreated: 0,
          gpp: 0,
          qc: 0,
          l1: 0,
          l2: 0,
          l3: 0,
          artifactCount: 0,
          weeks: new Set(),
          lastUpdatedMs: 0
        }

      summary.artifactCount += 1
      summary.weeks.add(weekBucket)
      summary.lastUpdatedMs = Math.max(summary.lastUpdatedMs, stat.mtimeMs)
      if (contentCategory === 'blog') summary.blogsCreated += 1
      if (contentCategory === 'gmb') summary.gpp += 1
      if (contentCategory === 'qc') summary.qc += 1
      if (contentCategory === 'l1') summary.l1 += 1
      if (contentCategory === 'l2') summary.l2 += 1
      if (contentCategory === 'l3') summary.l3 += 1
      summaries.set(clientSlug, summary)

      weekBuckets.add(weekBucket)
      artifacts.push({
        id: `${clientSlug}:${relativePath}`,
        name: entry.name,
        weekBucket,
        weekNumbers,
        clientSlug,
        clientName: summary.name,
        artifactType,
        contentCategory,
        level,
        workflow,
        date,
        modifiedAt,
        sizeBytes: stat.size,
        // Stored path should be workspace-style so the UI can form /ff_artifacts/<relativePath>.
        relativePath
      })
    }
  }

  // Ensure clients that only exist in planner state still appear in the dashboards.
  for (const [slug, totals] of plannerTotalsByClient.entries()) {
    if (!allowedClientSlugs.has(slug)) continue
    if (!summaries.has(slug)) {
      summaries.set(slug, {
        slug,
        name: clientNames[slug] ?? prettyClientName(slug),
        ordersCreated: 0,
        blogsCreated: 0,
        gpp: 0,
        qc: 0,
        l1: 0,
        l2: 0,
        l3: 0,
        artifactCount: 0,
        weeks: new Set(),
        lastUpdatedMs: 0
      })
    }
    const summary = summaries.get(slug)
    summary.ordersCreated = Math.max(summary.ordersCreated, totals.ordersCreated)
    summary.blogsCreated = Math.max(summary.blogsCreated, totals.blogsCreated)
    summary.gpp = Math.max(summary.gpp, totals.gpp)
    summary.l1 = Math.max(summary.l1, totals.l1)
    summary.l2 = Math.max(summary.l2, totals.l2)
    summary.l3 = Math.max(summary.l3, totals.l3)
  }

  // Ensure all known clients are represented, even with zero artifacts.
  for (const slug of allowedClientSlugs) {
    if (!summaries.has(slug)) {
      summaries.set(slug, {
        slug,
        name: clientNames[slug] ?? prettyClientName(slug),
        ordersCreated: 0,
        blogsCreated: 0,
        gpp: 0,
        qc: 0,
        l1: 0,
        l2: 0,
        l3: 0,
        artifactCount: 0,
        weeks: new Set(),
        lastUpdatedMs: 0
      })
    }
  }

  const clients = Array.from(summaries.values())
    .map((summary) => ({
      slug: summary.slug,
      name: summary.name,
      ordersCreated: summary.ordersCreated,
      blogsCreated: summary.blogsCreated,
      gpp: summary.gpp,
      qc: summary.qc,
      l1: summary.l1,
      l2: summary.l2,
      l3: summary.l3,
      artifactCount: summary.artifactCount,
      weeks: Array.from(summary.weeks).sort((a, b) => a.localeCompare(b)),
      lastUpdated: summary.lastUpdatedMs ? new Date(summary.lastUpdatedMs).toISOString() : null
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  artifacts.sort((a, b) => {
    const aKey = a.date ?? a.modifiedAt
    const bKey = b.date ?? b.modifiedAt
    if (aKey !== bKey) return bKey.localeCompare(aKey)
    return a.name.localeCompare(b.name)
  })

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    weeks: Array.from(weekBuckets).sort((a, b) => a.localeCompare(b)),
    clients,
    artifacts
  }
}

function main() {
  fs.mkdirSync(FF_STATE_DIR, { recursive: true })
  fs.mkdirSync(DEST_ARTIFACTS_ROOT, { recursive: true })

  rmrf(DEST_DELIVERABLES_DIR)
  copyTextTree(SOURCE_DELIVERABLES_DIR, DEST_DELIVERABLES_DIR)

  const payload = buildDeliverablesIndexFromCopiedTree()
  fs.writeFileSync(OUT_INDEX, `${JSON.stringify(payload, null, 2)}\n`)

  // eslint-disable-next-line no-console
  console.log(`Snapshot ready:\n- ${OUT_INDEX}\n- ${DEST_DELIVERABLES_DIR}`)
}

main()

