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
const LIVE_FILE = path.resolve(FF_STATE_DIR, 'live.json')
const PRODUCTION_METRICS_FILE = path.resolve(FF_STATE_DIR, 'production-metrics.json')
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

function sectionBody(rawMarkdown, headings, stopHeadings = []) {
  const markdown = String(rawMarkdown || '')
  const headingList = Array.isArray(headings) ? headings : [headings]
  for (const heading of headingList) {
    const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$`, 'im'))
    if (!match || match.index == null) continue
    const startIndex = match.index + match[0].length
    const rest = markdown.slice(startIndex)
    const candidates = stopHeadings
      .map((stopHeading) => {
        const escapedStop = String(stopHeading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const stopMatch = rest.match(new RegExp(`^##\\s+${escapedStop}\\s*$`, 'im'))
        return stopMatch && stopMatch.index != null ? stopMatch.index : null
      })
      .filter((value) => typeof value === 'number')
    const nextIndex = candidates.length > 0 ? Math.min(...candidates) : -1
    return (nextIndex >= 0 ? rest.slice(0, nextIndex) : rest).trim()
  }
  return ''
}

function plainWordCount(text) {
  const cleaned = stripMarkdown(String(text || ''))
  return cleaned ? cleaned.split(' ').filter(Boolean).length : 0
}

function countHeadingLevel(sectionText, level) {
  if (!sectionText) return 0
  const regex = new RegExp(`^${'#'.repeat(level)}\\s+\\S`, 'gm')
  return (sectionText.match(regex) ?? []).length
}

function countInternalLinks(sectionText) {
  const markdownLinks = (sectionText.match(/\[[^\]]+]\((?!https?:\/\/)([^)]+)\)/gi) ?? []).length
  const placeholderLinks = (sectionText.match(/\[Internal Link:[^\]]+\]/gi) ?? []).length
  return markdownLinks + placeholderLinks
}

function countExternalSources(sectionText) {
  const markdownLinks = (sectionText.match(/\[[^\]]+]\((https?:\/\/[^)]+)\)/gi) ?? []).length
  const bareUrls = (sectionText.match(/https?:\/\/[^\s)\]]+/gi) ?? []).length
  return Math.max(markdownLinks, bareUrls)
}

function normalizeQcStatus(value) {
  const upper = String(value || '').trim().toUpperCase()
  if (upper.includes('PASS')) return 'PASS'
  if (upper.includes('FAIL')) return 'FAIL'
  return null
}

function parseQcStatus(rawMarkdown) {
  const markdown = String(rawMarkdown || '')
  const hardGate = markdown.match(/hard\s*gate\s*(?:result)?\s*:\s*(pass|fail)/i)
  if (hardGate) return normalizeQcStatus(hardGate[1])
  const qcStatus = markdown.match(/qc[_\s-]*status\s*:\s*(pass|fail)/i)
  if (qcStatus) return normalizeQcStatus(qcStatus[1])
  return null
}

function parseQcScore(rawMarkdown) {
  const markdown = String(rawMarkdown || '')
  const patterns = [
    /overall\s*score\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i,
    /score[_\s-]*overall\s*:\s*(\d+(?:\.\d+)?)/i,
    /quality\s*score\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i
  ]
  for (const pattern of patterns) {
    const match = markdown.match(pattern)
    if (!match) continue
    const score = Number(match[1])
    if (Number.isFinite(score)) return Math.max(0, Math.min(10, score))
  }
  return null
}

function buildImageMetrics(images) {
  const list = Array.isArray(images) ? images : []
  const featured = list.some((image) => String(image?.category || '') === 'featured_thumbnail')
  const inlineCount = list.filter((image) => String(image?.category || '') === 'supporting_photo').length
  const infographicCount = list.filter((image) =>
    ['infographic', 'checklist_graphic', 'comparison_graphic'].includes(String(image?.category || '')),
  ).length
  const imageRevisionCount = list.reduce((sum, image) => {
    const revision = Number(image?.revision ?? 0)
    if (!Number.isFinite(revision) || revision <= 1) return sum
    return sum + (revision - 1)
  }, 0)

  return {
    featured_image_present: featured,
    inline_image_count: inlineCount,
    infographic_count: infographicCount,
    image_revision_count: imageRevisionCount
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
  const livePayload = loadJson(LIVE_FILE, { updatedAt: null, tasks: [] })
  const productionMetricsPayload = loadJson(PRODUCTION_METRICS_FILE, { windows: [] })
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
  const weekSnapshotDocs = []
  for (const filePath of listWeekStateFiles()) {
    const parsed = loadJson(filePath, null)
    const weekName = path.basename(filePath)
    const weekMatch = weekName.match(/^week(\d+)\.json$/i)
    const snapshotWeek = safeWeek(weekMatch?.[1] ?? parsed?.week)
    const extractedTasks = extractTasksFromWeekFile(parsed)
    if (snapshotWeek) {
      weekSnapshotDocs.push({
        _id: `ffstate-week-${snapshotWeek}`,
        _type: 'ffStateWeek',
        week: snapshotWeek,
        year: safeYear(parsed?.year, parsed?.updatedAt ?? ordersPayload.generatedAt),
        updatedAt: String(parsed?.updatedAt ?? ordersPayload.generatedAt ?? new Date().toISOString()),
        tasks: extractedTasks
      })
    }
    for (const task of extractedTasks) {
      if (!task || typeof task !== 'object') continue
      if (!task.id || !task.client_slug || !task.stage) continue
      taskDocs.push({
        _id: String(task.id),
        _type: 'task',
        ...task
      })
    }
  }

  const snapshotDocs = [
    {
      _id: 'ffstate-orders',
      _type: 'ffStateOrders',
      sourceCsv: String(ordersPayload.sourceCsv ?? ''),
      generatedAt: String(ordersPayload.generatedAt ?? new Date().toISOString()),
      orders: Array.isArray(ordersPayload.orders) ? ordersPayload.orders : []
    },
    {
      _id: 'ffstate-live',
      _type: 'ffStateLive',
      updatedAt: String(livePayload.updatedAt ?? ''),
      tasks: Array.isArray(livePayload.tasks) ? livePayload.tasks : []
    },
    {
      _id: 'ffstate-production-metrics',
      _type: 'ffStateProductionMetrics',
      generatedAt: String(productionMetricsPayload.generatedAt ?? ''),
      windows: Array.isArray(productionMetricsPayload.windows) ? productionMetricsPayload.windows : []
    },
    ...weekSnapshotDocs
  ]

  const existingArtifactDocs = await client.fetch(
    `*[_type == "artifact"]{_id, relativePath, images, metrics, body}`
  )
  const existingArtifactByPath = new Map()
  for (const doc of Array.isArray(existingArtifactDocs) ? existingArtifactDocs : []) {
    if (!doc?.relativePath) continue
    existingArtifactByPath.set(String(doc.relativePath), doc)
  }

  const deliverablePaths = walkDeliverables(DELIVERABLES_DIR)
  const artifactRecords = []
  const qcRecordsByFolder = new Map()
  const draftRecordsByFolder = new Map()
  for (const abs of deliverablePaths) {
    const rel = path.relative(WORKSPACE_ROOT, abs).split(path.sep).join('/')
    const parts = rel.split('/').filter(Boolean)
    if (parts[0] !== 'deliverables') continue
    const weekBucket = parts[1]
    const clientSlug = cleanSlug(parts[2])
    const artifactType = String(parts[3] ?? '')
    if (!weekBucket || !clientSlug || !artifactType) continue

    const name = path.basename(abs)
    const workflow = classifyWorkflow(name, rel, artifactType)
    const contentCategory = classifyContentCategory(name, rel, artifactType, workflow)
    const folderKey = path.dirname(abs)

    const record = {
      abs,
      rel,
      parts,
      weekBucket,
      clientSlug,
      artifactType,
      workflow,
      contentCategory,
      folderKey,
      name,
      rawMarkdown: fs.readFileSync(abs, 'utf8'),
      existing: existingArtifactByPath.get(rel) ?? null
    }
    artifactRecords.push(record)

    if (workflow === 'qc' || contentCategory === 'qc') {
      const list = qcRecordsByFolder.get(folderKey) ?? []
      list.push(record)
      qcRecordsByFolder.set(folderKey, list)
    }
    if (workflow === 'draft') {
      const list = draftRecordsByFolder.get(folderKey) ?? []
      list.push(record)
      draftRecordsByFolder.set(folderKey, list)
    }
  }

  const artifactDocs = []
  for (const record of artifactRecords) {
    const { abs, rel, parts, weekBucket, clientSlug, artifactType, workflow, contentCategory, name, rawMarkdown, existing, folderKey } = record

    const stat = fs.statSync(abs)
    const modifiedAt = stat.mtime.toISOString()
    const date = dateFromName(name)
    const weekNumbers = parseWeekNumbers(weekBucket)
    const level = classifyLevel(contentCategory)
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

    const bodyContent = sectionBody(rawMarkdown, ['body_content', 'article_body'], ['faq', 'internal_links_used', 'Sources'])
    const publishableWordCount = bodyContent ? plainWordCount(bodyContent) : null
    const h2CountBody = bodyContent ? countHeadingLevel(bodyContent, 2) : 0
    const internalLinksCount = bodyContent ? countInternalLinks(bodyContent) : 0
    const externalSourcesCount = bodyContent ? countExternalSources(bodyContent) : 0
    const pkFirstParagraph = bodyContent ? /\bpk\b/i.test(bodyContent.split(/\n\s*\n/)[0] ?? '') : false

    const qcRecords = qcRecordsByFolder.get(folderKey) ?? []
    const qcStatuses = qcRecords.map((item) => parseQcStatus(item.rawMarkdown)).filter(Boolean)
    const qcScores = qcRecords.map((item) => parseQcScore(item.rawMarkdown)).filter((value) => Number.isFinite(value))
    const latestQcRecord = qcRecords
      .slice()
      .sort((a, b) => fs.statSync(b.abs).mtimeMs - fs.statSync(a.abs).mtimeMs)[0] ?? null
    const latestQcStatus =
      normalizeQcStatus(markers.qcStatus) ??
      parseQcStatus(latestQcRecord?.rawMarkdown ?? '') ??
      (qcStatuses.find((value) => value === 'PASS') ? 'PASS' : qcStatuses[0] ?? null)
    const scoreOverall = latestQcRecord ? parseQcScore(latestQcRecord.rawMarkdown) : (qcScores[0] ?? null)
    const qcFailCountBeforePass =
      latestQcStatus === 'PASS' ? qcStatuses.filter((value) => value === 'FAIL').length : qcStatuses.filter((value) => value === 'FAIL').length

    const contentRevisionCount = revisionCount ?? Math.max(0, (draftRecordsByFolder.get(folderKey)?.length ?? 1) - 1)
    const existingImages = Array.isArray(existing?.images) ? existing.images : []
    const imageMetrics = buildImageMetrics(existingImages)
    const metrics = {
      qc_status: latestQcStatus,
      score_overall: scoreOverall,
      publishable_word_count: publishableWordCount,
      h2_count_body: h2CountBody,
      pk_first_paragraph: pkFirstParagraph,
      internal_links_count: internalLinksCount,
      external_sources_count: externalSourcesCount,
      content_revision_count: contentRevisionCount,
      qc_fail_count_before_pass: qcFailCountBeforePass,
      qc_artifact_id: latestQcRecord ? `artifact-${sha1(latestQcRecord.rel).slice(0, 16)}` : null,
      ...imageMetrics
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
      metrics,
      images: existingImages,
      body: Array.isArray(existing?.body) ? existing.body : []
    })
  }

  await upsertDocs(client, clientsDocs, { dryRun })
  await upsertDocs(client, snapshotDocs, { dryRun })
  await upsertDocs(client, orderDocs, { dryRun })
  await upsertDocs(client, taskDocs, { dryRun })
  await upsertDocs(client, artifactDocs, { dryRun })

  // eslint-disable-next-line no-console
  console.log(`Sanity sync complete. clients=${clientsDocs.length} snapshots=${snapshotDocs.length} orders=${orderDocs.length} tasks=${taskDocs.length} artifacts=${artifactDocs.length}`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exitCode = 1
})
