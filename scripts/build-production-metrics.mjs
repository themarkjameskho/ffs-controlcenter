import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..')
const DELIVERABLES_DIR = path.resolve(WORKSPACE_ROOT, 'deliverables')
const FF_STATE_DIR = path.resolve(PROJECT_ROOT, 'public', 'ff_state')
const ORDERS_PATH = path.resolve(FF_STATE_DIR, 'orders.json')
const OUT_PATH = path.resolve(FF_STATE_DIR, 'production-metrics.json')

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function average(values) {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (clean.length === 0) return null
  return Math.round((clean.reduce((sum, value) => sum + value, 0) / clean.length) * 10) / 10
}

function percentOrNull(numerator, denominator) {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 100)
}

function parseWeekNumbers(weekBucket) {
  const match = String(weekBucket).match(/^week(\d{1,2})(?:-(\d{1,2}))?(?:[-_].+)?$/i)
  if (!match) return []
  const start = Number(match[1])
  const end = Number(match[2] ?? match[1])
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  return Array.from({ length: hi - lo + 1 }, (_, index) => lo + index)
}

function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sectionBody(rawMarkdown, headingName, stopHeadings = []) {
  const markdown = String(rawMarkdown || '')
  const escaped = String(headingName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$`, 'im'))
  if (!match || match.index == null) return ''
  const start = match.index + match[0].length
  const rest = markdown.slice(start)
  const candidates = stopHeadings
    .map((heading) => {
      const escapedStop = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const stopMatch = rest.match(new RegExp(`^##\\s+${escapedStop}\\s*$`, 'im'))
      return stopMatch && stopMatch.index != null ? stopMatch.index : null
    })
    .filter((value) => typeof value === 'number')
  const nextIndex = candidates.length > 0 ? Math.min(...candidates) : -1
  return (nextIndex >= 0 ? rest.slice(0, nextIndex) : rest).trim()
}

function countWords(text) {
  const cleaned = stripMarkdown(text)
  return cleaned ? cleaned.split(' ').filter(Boolean).length : 0
}

function parseQcStatus(markdown) {
  const upper = String(markdown || '').toUpperCase()
  if (upper.includes('HARD GATE RESULT: PASS') || upper.includes('\nPASS\n') || upper.includes(' PASS ')) return 'PASS'
  if (upper.includes('HARD GATE RESULT: FAIL') || upper.includes('\nFAIL\n') || upper.includes(' FAIL ')) return 'FAIL'
  return null
}

function parseQcScore(markdown) {
  const text = String(markdown || '')
  const patterns = [
    /score[_\s-]*overall[^0-9]{0,12}(\d+(?:\.\d+)?)/i,
    /overall score[^0-9]{0,12}(\d+(?:\.\d+)?)/i,
    /qc score[^0-9]{0,12}(\d+(?:\.\d+)?)/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return Number(match[1])
  }
  return null
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return []
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile())
  } catch {
    return []
  }
}

function currentDraftPath(unitDir) {
  const files = listFiles(unitDir)
    .map((entry) => path.join(unitDir, entry.name))
    .filter((filePath) => /_draft\.md$/i.test(path.basename(filePath)))
  if (files.length === 0) return null
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0]
}

function qcFilePath(unitDir) {
  const files = listFiles(unitDir)
    .map((entry) => path.join(unitDir, entry.name))
    .filter((filePath) => /_qc(_v1)?\.md$/i.test(path.basename(filePath)))
  if (files.length === 0) return null
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0]
}

function archiveRevisionCount(unitDir) {
  const archiveDir = path.join(unitDir, '__archive')
  if (!fs.existsSync(archiveDir)) return 0
  return listFiles(archiveDir).filter((entry) => /_draft\.md$/i.test(entry.name)).length
}

function inferCategory(typeBucket) {
  const value = String(typeBucket || '').toLowerCase()
  if (value === 'blog_post') return 'blog'
  if (value === 'link_1') return 'l1'
  if (value === 'link_2') return 'l2'
  if (value === 'link_3') return 'l3'
  if (value === 'gpp_post' || value === 'gbp_post') return 'gmb'
  return 'other'
}

function scanUnits() {
  const units = []
  if (!fs.existsSync(DELIVERABLES_DIR)) return units

  for (const weekDir of listDirs(DELIVERABLES_DIR)) {
    const weekBucket = weekDir.name
    const weekPath = path.join(DELIVERABLES_DIR, weekBucket)
    for (const clientDir of listDirs(weekPath)) {
      const clientSlug = clientDir.name
      const clientPath = path.join(weekPath, clientSlug)
      for (const typeDir of listDirs(clientPath)) {
        const typeBucket = typeDir.name
        const typePath = path.join(clientPath, typeBucket)
        for (const unitDir of listDirs(typePath)) {
          if (unitDir.name === '__archive' || unitDir.name.startsWith('pack_')) continue
          const unitPath = path.join(typePath, unitDir.name)
          const draftPath = currentDraftPath(unitPath)
          const qcPath = qcFilePath(unitPath)
          const category = inferCategory(typeBucket)
          const draftMarkdown = draftPath ? fs.readFileSync(draftPath, 'utf8') : ''
          const qcMarkdown = qcPath ? fs.readFileSync(qcPath, 'utf8') : ''
          const body = sectionBody(draftMarkdown, 'body_content', ['faq', 'internal_links_used', 'Sources'])
          const wordCount = body ? countWords(body) : null
          const revisions = draftPath ? archiveRevisionCount(unitPath) : null
          units.push({
            unitKey: `${weekBucket}|${clientSlug}|${typeBucket}|${unitDir.name}`,
            weekBucket,
            weekNumbers: parseWeekNumbers(weekBucket),
            clientSlug,
            category,
            draftPath,
            qcPath,
            qcStatus: parseQcStatus(qcMarkdown),
            qcScore: parseQcScore(qcMarkdown),
            publishableWordCount: wordCount,
            contentRevisionCount: revisions,
            imageRevisionCount: 0
          })
        }
      }
    }
  }
  return units
}

const orders = readJson(ORDERS_PATH, { orders: [] })
const units = scanUnits()

const windows = (Array.isArray(orders.orders) ? orders.orders : []).map((order) => {
  const relevant = units.filter((unit) => unit.weekNumbers.some((week) => week >= order.startWeek && week <= order.endWeek))
  const qcKnown = relevant.filter((unit) => unit.qcStatus)
  const qcPassed = qcKnown.filter((unit) => unit.qcStatus === 'PASS')
  const blogs = relevant.filter((unit) => unit.category === 'blog')
  const links = relevant.filter((unit) => ['l1', 'l2', 'l3'].includes(unit.category))
  return {
    key: `${order.year}:${order.startWeek}-${order.endWeek}`,
    label: order.label,
    year: order.year,
    startWeek: order.startWeek,
    endWeek: order.endWeek,
    qcPassRate: percentOrNull(qcPassed.length, qcKnown.length),
    avgQcScore: average(relevant.map((unit) => unit.qcScore)),
    avgBlogWords: average(blogs.map((unit) => unit.publishableWordCount)),
    avgLinkWords: average(links.map((unit) => unit.publishableWordCount)),
    avgContentRevisions: average(relevant.map((unit) => unit.contentRevisionCount)),
    avgImageRevisions: average(relevant.map((unit) => unit.imageRevisionCount))
  }
})

const output = {
  ok: true,
  generatedAt: new Date().toISOString(),
  windows,
  units
}

fs.mkdirSync(FF_STATE_DIR, { recursive: true })
fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${OUT_PATH}`)
