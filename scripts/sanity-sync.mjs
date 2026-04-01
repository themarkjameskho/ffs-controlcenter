import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@sanity/client'
import dotenv from 'dotenv'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..')

// Load local env automatically (never commit it; .gitignore covers it).
// Prefer `.env.local` (matches Vite convention), fallback to `.env`.
const ENV_LOCAL_FILE = path.resolve(REPO_ROOT, '.env.local')
const ENV_FILE = path.resolve(REPO_ROOT, '.env')
if (fs.existsSync(ENV_LOCAL_FILE)) {
  dotenv.config({ path: ENV_LOCAL_FILE })
} else if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE })
}

const FF_STATE_DIR = path.resolve(REPO_ROOT, 'public', 'ff_state')
const CLIENTS_FILE = path.resolve(FF_STATE_DIR, 'clients.json')
const ORDERS_FILE = path.resolve(FF_STATE_DIR, 'orders.json')
const DELIVERABLES_DIR = path.resolve(WORKSPACE_ROOT, 'deliverables')

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

function cleanSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
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

function listWeekStateFiles() {
  if (!fs.existsSync(FF_STATE_DIR)) return []
  return fs
    .readdirSync(FF_STATE_DIR)
    .filter((name) => /^week\d+\.json$/i.test(name))
    .sort()
    .map((name) => path.join(FF_STATE_DIR, name))
}

function extractTasksFromWeekFile(parsed) {
  if (Array.isArray(parsed?.tasks)) return parsed.tasks
  if (parsed?.clients && typeof parsed.clients === 'object') {
    const out = []
    for (const entry of Object.values(parsed.clients)) {
      if (!entry || typeof entry !== 'object') continue
      if (!Array.isArray(entry.tasks)) continue
      out.push(...entry.tasks)
    }
    return out
  }
  return []
}

function walkDeliverables(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    const entries = fs.readdirSync(cur, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(cur, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '_reports') continue
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.md')) continue
      out.push(abs)
    }
  }
  return out
}

function sanityWriteClient() {
  const projectId = requiredEnv('SANITY_PROJECT_ID')
  const dataset = requiredEnv('SANITY_DATASET')
  const apiVersion = requiredEnv('SANITY_API_VERSION')
  const token = requiredEnv('SANITY_WRITE_TOKEN')
  return createClient({ projectId, dataset, apiVersion, token, useCdn: false })
}

async function upsertDocs(client, docs, { dryRun }) {
  if (docs.length === 0) return
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] would upsert ${docs.length} docs`)
    return
  }
  const tx = client.transaction()
  for (const doc of docs) tx.createOrReplace(doc)
  await tx.commit()
}

function loadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function loadJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function estimateSyllables(word) {
  const w = String(word || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const matches = w.match(/[aeiouy]+/g)
  let count = matches ? matches.length : 0
  if (w.endsWith('e')) count -= 1
  if (w.endsWith('le') && w.length > 2 && !/[aeiouy]/.test(w[w.length - 3] || '')) count += 1
  return Math.max(1, count)
}

function markdownSignals(rawMarkdown) {
  const raw = String(rawMarkdown || '')
  const headingCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }
  for (const line of raw.split('\n')) {
    const m = line.match(/^(#{1,6})\s+\S/)
    if (!m) continue
    const level = m[1].length
    const key = `h${level}`
    // eslint-disable-next-line no-prototype-builtins
    if (headingCounts.hasOwnProperty(key)) headingCounts[key] += 1
  }

  const imageCount = (raw.match(/!\[[^\]]*]\([^)]*\)/g) ?? []).length + (raw.match(/<img\b[^>]*>/gi) ?? []).length
  const links = raw.match(/\[[^\]]+]\(([^)]+)\)/g) ?? []
  const linkCount = links.length
  const externalLinkCount = (raw.match(/\[[^\]]+]\((https?:\/\/[^)]+)\)/gi) ?? []).length

  const text = stripMarkdown(raw)
  const words = text ? text.split(' ').filter(Boolean) : []
  const wordCount = words.length

  const sentenceCount = Math.max(1, (text.match(/[.!?]+/g) ?? []).length)
  const syllableCount = words.reduce((sum, w) => sum + estimateSyllables(w), 0)

  // Flesch Reading Ease (rough); clamp to 0..100 for UI.
  const wordsPerSentence = wordCount / sentenceCount
  const syllablesPerWord = wordCount > 0 ? syllableCount / wordCount : 0
  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord
  const readabilityScore = Math.max(0, Math.min(100, Math.round(flesch)))

  // Lightweight SEO heuristic (0..100). This is intentionally simple + stable.
  let seoScore = 100
  if (wordCount < 350) seoScore -= 30
  if (wordCount < 600) seoScore -= 10
  if (headingCounts.h2 + headingCounts.h3 < 3) seoScore -= 15
  if (linkCount < 2) seoScore -= 15
  if (externalLinkCount < 1) seoScore -= 5
  if (imageCount < 1) seoScore -= 10
  if (headingCounts.h1 > 1) seoScore -= 10
  seoScore = Math.max(0, Math.min(100, Math.round(seoScore)))

  return {
    wordCount,
    sentenceCount,
    linkCount,
    externalLinkCount,
    imageCount,
    headingCounts,
    readabilityScore,
    seoScore
  }
}

function safeYear(value, fallbackIso) {
  const n = Number(value)
  if (Number.isFinite(n) && n >= 2000) return Math.trunc(n)
  const fromStamp = fallbackIso ? new Date(String(fallbackIso)).getFullYear() : NaN
  if (Number.isFinite(fromStamp) && fromStamp >= 2000) return fromStamp
  return new Date().getFullYear()
}

function safeWeek(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(1, Math.min(53, Math.trunc(n)))
}

function argFlag(name) {
  return process.argv.includes(name)
}

async function main() {
  const dryRun = argFlag('--dry-run')
  const client = sanityWriteClient()

  const existingOrderWindows = await client.fetch(
    `*[_type == "orderWindow"]{_id, id, year, startWeek, endWeek}`
  )
  const existingOrderIdByRange = new Map()
  for (const entry of Array.isArray(existingOrderWindows) ? existingOrderWindows : []) {
    const key = `${Number(entry.startWeek)}-${Number(entry.endWeek)}`
    if (!existingOrderIdByRange.has(key) && entry?._id) {
      existingOrderIdByRange.set(key, { _id: String(entry._id), id: String(entry.id ?? '') })
    }
  }

  const clientsPayload = loadJson(CLIENTS_FILE, { clients: [] })
  const clientsDocs = (clientsPayload.clients ?? [])
    .map((c) => ({ slug: cleanSlug(c.slug), name: String(c.name ?? '').trim() }))
    .filter((c) => c.slug)
    .map((c) => ({ _id: `client-${c.slug}`, _type: 'client', ...c }))

  const ordersPayload = loadJson(ORDERS_FILE, { orders: [] })
  const orderDocs = (ordersPayload.orders ?? []).map((o) => {
    const year = safeYear(o.year, ordersPayload.generatedAt)
    const startWeek = safeWeek(o.startWeek)
    const endWeek = safeWeek(o.endWeek)
    const rangeKey = `${startWeek}-${endWeek}`
    const existing = existingOrderIdByRange.get(rangeKey) ?? null
    const computedId = `order-${year}-week${startWeek}-${endWeek}`
    const id = existing?.id ? existing.id : computedId
    return {
      _id: existing?._id ? existing._id : `order-${year}-${startWeek}-${endWeek}`,
      _type: 'orderWindow',
      id: computedId,
      label: String(o.label ?? ''),
      year,
      startWeek,
      endWeek,
      plannedTotal: Number(o.plannedTotal ?? 0),
      plannedByClient: o.plannedByClient ?? {},
      plannedByType: o.plannedByType ?? {},
      source: String(ordersPayload.sourceCsv ?? ''),
      generatedAt: String(ordersPayload.generatedAt ?? new Date().toISOString())
    }
  })

  const taskDocs = []
  for (const filePath of listWeekStateFiles()) {
    const parsed = loadJson(filePath, null)
    for (const task of extractTasksFromWeekFile(parsed)) {
      if (!task || typeof task !== 'object') continue
      if (!task.id || !task.client_slug || !task.stage) continue
      taskDocs.push({
        _id: String(task.id),
        _type: 'task',
        ...task
      })
    }
  }

  const artifactDocs = []
  for (const abs of walkDeliverables(DELIVERABLES_DIR)) {
    const rel = path.relative(WORKSPACE_ROOT, abs).split(path.sep).join('/')
    const parts = rel.split('/').filter(Boolean)
    // deliverables/<weekBucket>/<clientSlug>/<artifactType>/...
    if (parts[0] !== 'deliverables') continue
    const weekBucket = parts[1]
    const clientSlug = cleanSlug(parts[2])
    const artifactType = String(parts[3] ?? '')
    if (!weekBucket || !clientSlug || !artifactType) continue

    const stat = fs.statSync(abs)
    const modifiedAt = stat.mtime.toISOString()
    const name = path.basename(abs)
    const date = dateFromName(name)
    const weekNumbers = parseWeekNumbers(weekBucket)
    const workflow = classifyWorkflow(name, rel, artifactType)
    const contentCategory = classifyContentCategory(name, rel, artifactType, workflow)
    const level = classifyLevel(contentCategory)
    const rawMarkdown = fs.readFileSync(abs, 'utf8')
    const analysis = markdownSignals(rawMarkdown)
    const docId = `artifact-${sha1(rel).slice(0, 16)}`

    const postFolder = path.dirname(abs)
    const markerDir = path.join(postFolder, '.ff')
    const writerDone = loadJsonIfExists(path.join(markerDir, 'writer_done.json'))
    const qcDone = loadJsonIfExists(path.join(markerDir, 'qc_done.json'))
    const publishStatus = loadJsonIfExists(path.join(markerDir, 'publish_status.json'))
    const imageStatus = loadJsonIfExists(path.join(markerDir, 'image_status.json'))
    const revisionLog = loadJsonIfExists(path.join(markerDir, 'revision_log.json'))
    const revisionEvents = Array.isArray(revisionLog?.events) ? revisionLog.events : []
    const revisionCount = revisionEvents.length || null
    const revisionLastAt = revisionCount ? revisionEvents[revisionEvents.length - 1]?.timestamp ?? null : null

    const markers = {
      writerDoneAt: writerDone?.timestamp ?? null,
      qcDoneAt: qcDone?.timestamp ?? null,
      qcStatus: qcDone?.qc_status ?? null,
      publishStatus: publishStatus?.status ?? null,
      publishUpdatedAt: publishStatus?.timestamp ?? null,
      imageStatus: imageStatus?.status ?? null,
      imageUpdatedAt: imageStatus?.timestamp ?? null,
      revisionCount,
      revisionLastAt
    }

    artifactDocs.push({
      _id: docId,
      _type: 'artifact',
      id: docId,
      title: name.replace(/\.[^.]+$/, ''),
      name,
      weekBucket,
      weekNumbers,
      clientSlug,
      artifactType,
      contentCategory,
      level,
      workflow,
      date,
      modifiedAt,
      sizeBytes: stat.size,
      relativePath: rel,
      rawMarkdown,
      analysis,
      markers,
      body: []
    })
  }

  await upsertDocs(client, clientsDocs, { dryRun })
  await upsertDocs(client, orderDocs, { dryRun })
  await upsertDocs(client, taskDocs, { dryRun })
  await upsertDocs(client, artifactDocs, { dryRun })

  // eslint-disable-next-line no-console
  console.log(`Sanity sync complete. clients=${clientsDocs.length} orders=${orderDocs.length} tasks=${taskDocs.length} artifacts=${artifactDocs.length}`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exitCode = 1
})
