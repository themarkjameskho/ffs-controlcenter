import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..')
const HUMAN_ORDERS_DIR = path.resolve(WORKSPACE_ROOT, 'human_orders')
const INBOX_DIR = path.resolve(HUMAN_ORDERS_DIR, '_inbox')
const PROCESSED_DIR = path.resolve(HUMAN_ORDERS_DIR, 'processed')
const AGENT_POOLS_FILE = path.resolve(HUMAN_ORDERS_DIR, 'agent-pools.json')
const FF_STATE_DIR = path.resolve(PROJECT_ROOT, 'public', 'ff_state')
const ORDER_SNAPSHOT_FILE = path.resolve(FF_STATE_DIR, 'orders.json')

const SUPPORTED_INPUT_EXTENSIONS = new Set(['.csv', '.json', '.md', '.txt'])
const STAGES = ['human-order', 'planner', 'researcher', 'writer', 'qc', 'publisher']
const STAGE_RANK = new Map(STAGES.map((stage, index) => [stage, index]))

const DEFAULT_AGENT_POOLS = {
  planner: ['planner-agent-1'],
  researcher: ['researcher-agent-1', 'researcher-agent-2'],
  writer: ['writer-agent-1', 'writer-agent-2'],
  qc: ['qc-agent-1'],
  publisher: ['publisher-agent-1']
}

function parseArgs(argv) {
  const args = {
    input: '',
    year: null,
    write: true
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--input' || token === '--csv' || token === '--order') {
      args.input = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (token === '--year') {
      args.year = asInt(argv[i + 1], null)
      i += 1
      continue
    }
    if (token === '--dry-run') {
      args.write = false
      continue
    }
    if (token === '--help' || token === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  npm run orders:plan -- --input ../human_orders/_inbox/Test_4.csv
  npm run orders:plan -- --input ../human_orders/_inbox/new-order.md
  npm run orders:plan -- --dry-run

Supported inputs:
  - CSV rows with columns: client,start_week,end_week,content_type,quantity
  - JSON order files
  - Markdown/Text human order files with key:value blocks

Optional config:
  ${AGENT_POOLS_FILE}
`)
}

function asInt(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}

function cleanSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function prettyLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function normalizeContentType(value) {
  const slug = cleanSlug(value)
  if (!slug) return ''
  if (slug === 'gbp_post') return 'gpp_post'
  if (slug === 'gmb_post') return 'gpp_post'
  if (slug === 'google_business_profile') return 'gpp_post'
  return slug
}

function contentTypeLabel(contentType) {
  const normalized = normalizeContentType(contentType)
  if (normalized === 'blog_post') return 'Blog Post'
  if (normalized === 'gpp_post') return 'GPP Post'
  if (normalized === 'link_1') return 'Link 1'
  if (normalized === 'link_2') return 'Link 2'
  if (normalized === 'link_3') return 'Link 3'
  return prettyLabel(normalized || 'task')
}

function normalizeWeekRange(startWeek, endWeek) {
  const start = Math.max(1, Math.min(53, asInt(startWeek, 0)))
  const end = Math.max(1, Math.min(53, asInt(endWeek, start)))
  if (!start || !end) return null
  return [Math.min(start, end), Math.max(start, end)]
}

function isoWeekStartDate(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const day = jan4.getUTCDay() || 7
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (day - 1))

  const monday = new Date(mondayWeek1)
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7)
  return monday
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function ymd(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function splitCsvLine(line) {
  const out = []
  let value = ''
  let quote = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (quote && line[i + 1] === '"') {
        value += '"'
        i += 1
      } else {
        quote = !quote
      }
      continue
    }
    if (ch === ',' && !quote) {
      out.push(value)
      value = ''
      continue
    }
    value += ch
  }
  out.push(value)
  return out.map((cell) => cell.trim())
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return []

  const headers = splitCsvLine(lines[0]).map((header) => cleanSlug(header))
  const rows = []
  for (let index = 1; index < lines.length; index += 1) {
    const values = splitCsvLine(lines[index])
    const row = {}
    headers.forEach((header, cellIndex) => {
      row[header] = values[cellIndex] ?? ''
    })
    rows.push(row)
  }
  return rows
}

function parseKeyValueBlocks(content) {
  const lines = content.split(/\r?\n/)
  const blocks = []
  let current = []

  function flush() {
    const meaningful = current
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    if (meaningful.length > 0) blocks.push(meaningful)
    current = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()

  return blocks.map((block) => {
    const record = {}
    for (const rawLine of block) {
      const line = rawLine.trim()
      const sep = line.indexOf(':')
      if (sep <= 0) continue
      const key = cleanSlug(line.slice(0, sep))
      const value = line.slice(sep + 1).trim()
      if (!key) continue
      record[key] = value
    }
    return record
  })
}

function normalizeWeekFields(record, fallbackYear) {
  const recordYear = asInt(record.year, fallbackYear)
  const weeksText = String(record.weeks || record.week_range || '').trim()
  const weekText = String(record.week || '').trim()

  if (weeksText) {
    const match = weeksText.match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/)
    if (match) {
      const range = normalizeWeekRange(match[1], match[2] ?? match[1])
      if (range) return { year: recordYear, startWeek: range[0], endWeek: range[1] }
    }
  }

  if (weekText) {
    const range = normalizeWeekRange(weekText, weekText)
    if (range) return { year: recordYear, startWeek: range[0], endWeek: range[1] }
  }

  const range = normalizeWeekRange(record.start_week, record.end_week || record.start_week)
  if (!range) return null
  return { year: recordYear, startWeek: range[0], endWeek: range[1] }
}

function expandDeliverableMap({
  client,
  clientSlug,
  clientName,
  year,
  startWeek,
  endWeek,
  rawRecord,
  sourcePath
}) {
  const rows = []

  if (rawRecord.content_type || rawRecord.quantity) {
    const contentType = normalizeContentType(rawRecord.content_type)
    const quantity = asInt(rawRecord.quantity, 0)
    if (contentType && quantity > 0) {
      rows.push({
        client,
        clientSlug,
        clientName,
        year,
        startWeek,
        endWeek,
        contentType,
        quantity,
        sourcePath
      })
    }
  }

  for (const [rawKey, rawValue] of Object.entries(rawRecord)) {
    const key = normalizeContentType(rawKey)
    if (!key || ['client', 'client_slug', 'year', 'week', 'weeks', 'week_range', 'start_week', 'end_week', 'label', 'notes', 'content_type', 'quantity'].includes(key)) {
      continue
    }
    const quantity = asInt(rawValue, 0)
    if (quantity <= 0) continue
    rows.push({
      client,
      clientSlug,
      clientName,
      year,
      startWeek,
      endWeek,
      contentType: key,
      quantity,
      sourcePath
    })
  }

  return rows
}

function normalizeInputRecords(records, options) {
  const currentYear = new Date().getFullYear()
  const fallbackYear = asInt(options.forcedYear, currentYear)
  const items = []

  for (const record of records) {
    const client = String(record.client || record.client_name || record.client_slug || '').trim()
    const clientSlug = cleanSlug(record.client_slug || client)
    if (!clientSlug) continue
    const clientName = client || prettyLabel(clientSlug)
    const weekFields = normalizeWeekFields(record, fallbackYear)
    if (!weekFields) continue

    items.push(
      ...expandDeliverableMap({
        client,
        clientSlug,
        clientName,
        year: weekFields.year,
        startWeek: weekFields.startWeek,
        endWeek: weekFields.endWeek,
        rawRecord: record,
        sourcePath: options.sourcePath
      })
    )
  }

  return items.filter((item) => item.quantity > 0 && item.contentType)
}

function parseJsonOrder(content, options) {
  const parsed = JSON.parse(content)
  const root = Array.isArray(parsed) ? { items: parsed } : parsed
  const records = []

  if (Array.isArray(root.rows)) {
    records.push(...root.rows)
  }

  if (Array.isArray(root.items)) {
    for (const item of root.items) {
      if (item && typeof item === 'object' && item.deliverables && typeof item.deliverables === 'object') {
        records.push({
          ...item,
          ...item.deliverables
        })
        continue
      }
      records.push(item)
    }
  }

  if (records.length === 0 && Array.isArray(parsed)) {
    records.push(...parsed)
  }

  if (records.length === 0 && root && typeof root === 'object') {
    records.push(root)
  }

  const items = normalizeInputRecords(records, options)
  const label = String(root.label || path.basename(options.sourcePath, path.extname(options.sourcePath)) || 'order-plan').trim()
  return {
    label,
    sourceType: 'json',
    sourcePath: options.sourcePath,
    items
  }
}

function parseHumanOrderText(content, options) {
  const blocks = parseKeyValueBlocks(content)
  const metadata = {}
  const records = []

  for (const block of blocks) {
    if (block.client || block.client_slug || block.content_type || block.blog_post || block.gpp_post || block.link_1 || block.link_2 || block.link_3) {
      records.push(block)
      continue
    }
    Object.assign(metadata, block)
  }

  const mergedRecords = records.map((record) => ({
    ...metadata,
    ...record
  }))

  const items = normalizeInputRecords(mergedRecords, options)
  const label = String(metadata.label || path.basename(options.sourcePath, path.extname(options.sourcePath)) || 'human-order').trim()
  return {
    label,
    sourceType: 'human-order',
    sourcePath: options.sourcePath,
    items
  }
}

function parseCsvOrder(content, options) {
  const rows = parseCsv(content)
  const items = normalizeInputRecords(rows, options)
  const label = path.basename(options.sourcePath, path.extname(options.sourcePath)) || 'csv-order'
  return {
    label,
    sourceType: 'csv',
    sourcePath: options.sourcePath,
    items
  }
}

function readInputFile(filePath, forcedYear) {
  const ext = path.extname(filePath).toLowerCase()
  const content = fs.readFileSync(filePath, 'utf8')
  const options = { sourcePath: filePath, forcedYear }

  if (ext === '.csv') return parseCsvOrder(content, options)
  if (ext === '.json') return parseJsonOrder(content, options)
  if (ext === '.md' || ext === '.txt') return parseHumanOrderText(content, options)

  throw new Error(`Unsupported input type: ${ext}`)
}

function listSupportedInputsNewestFirst() {
  if (!fs.existsSync(INBOX_DIR)) return []
  return fs
    .readdirSync(INBOX_DIR)
    .map((name) => path.join(INBOX_DIR, name))
    .filter((fullPath) => {
      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) return false
      return SUPPORTED_INPUT_EXTENSIONS.has(path.extname(fullPath).toLowerCase())
    })
    .map((fullPath) => ({
      fullPath,
      mtimeMs: fs.statSync(fullPath).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function resolveInputPath(explicitInput) {
  if (explicitInput) {
    const candidate = path.resolve(PROJECT_ROOT, explicitInput)
    if (fs.existsSync(candidate)) return candidate
    const absolute = path.resolve(explicitInput)
    if (fs.existsSync(absolute)) return absolute
    throw new Error(`Input not found: ${explicitInput}`)
  }

  const latest = listSupportedInputsNewestFirst()[0]
  if (!latest) {
    throw new Error(`No supported input files found in ${INBOX_DIR}`)
  }
  return latest.fullPath
}

function safePlanId(label, sourcePath) {
  const labelSlug = cleanSlug(label || path.basename(sourcePath, path.extname(sourcePath)))
  return labelSlug || 'order-plan'
}

function buildRegistry(normalized) {
  const generatedAt = new Date().toISOString()
  const byRange = new Map()

  for (const item of normalized.items) {
    const key = `${item.year}:${item.startWeek}-${item.endWeek}`
    if (!byRange.has(key)) {
      byRange.set(key, {
        id: `order-${item.year}-week${item.startWeek}-${item.endWeek}`,
        label: `Week ${item.startWeek}-${item.endWeek}`,
        year: item.year,
        startWeek: item.startWeek,
        endWeek: item.endWeek,
        plannedTotal: 0,
        plannedByClient: {},
        plannedByType: {}
      })
    }
    const entry = byRange.get(key)
    entry.plannedTotal += item.quantity
    entry.plannedByClient[item.clientSlug] = (entry.plannedByClient[item.clientSlug] ?? 0) + item.quantity
    entry.plannedByType[item.contentType] = (entry.plannedByType[item.contentType] ?? 0) + item.quantity
  }

  return {
    ok: true,
    sourceCsv: normalized.sourceType === 'csv' ? normalized.sourcePath : '',
    sourceInput: normalized.sourcePath,
    sourceType: normalized.sourceType,
    generatedAt,
    orders: Array.from(byRange.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year
      return a.startWeek - b.startWeek
    })
  }
}

function loadAgentPools() {
  if (!fs.existsSync(AGENT_POOLS_FILE)) return DEFAULT_AGENT_POOLS
  try {
    const raw = fs.readFileSync(AGENT_POOLS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const pools = {}
    for (const key of Object.keys(DEFAULT_AGENT_POOLS)) {
      const list = Array.isArray(parsed[key]) ? parsed[key] : DEFAULT_AGENT_POOLS[key]
      pools[key] = list.map((value) => String(value || '').trim()).filter(Boolean)
      if (pools[key].length === 0) pools[key] = DEFAULT_AGENT_POOLS[key]
    }
    return pools
  } catch (error) {
    console.warn(`Warning: failed to read ${AGENT_POOLS_FILE}, using defaults.`)
    return DEFAULT_AGENT_POOLS
  }
}

function createOwnerAssigner(agentPools) {
  const cursor = {}
  return (stageKey) => {
    const pool = agentPools[stageKey] ?? []
    if (pool.length === 0) return `${stageKey}-agent-1`
    const index = cursor[stageKey] ?? 0
    cursor[stageKey] = index + 1
    return pool[index % pool.length]
  }
}

function describeDeliverables(deliverables) {
  const parts = Object.entries(deliverables)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([contentType, quantity]) => `${contentType}: ${quantity}`)
  return parts.length ? parts.join(' | ') : 'No deliverables'
}

function scheduleDates(year, week, slotIndex) {
  const weekStart = isoWeekStartDate(year, week)
  const researchOffset = slotIndex % 5
  const writerOffset = Math.min(researchOffset + 1, 4)
  const qcOffset = Math.min(researchOffset + 2, 4)
  const publishOffset = Math.min(researchOffset + 3, 4)
  return {
    research_date: ymd(addDays(weekStart, researchOffset)),
    writer_date: ymd(addDays(weekStart, writerOffset)),
    qc_date: ymd(addDays(weekStart, qcOffset)),
    publish_date: ymd(addDays(weekStart, publishOffset)),
    eta: ymd(addDays(weekStart, publishOffset))
  }
}

function ensureWeekBucket(planWeeks, year, week) {
  const key = `${year}:${week}`
  if (!planWeeks.has(key)) {
    const monday = isoWeekStartDate(year, week)
    planWeeks.set(key, {
      year,
      week,
      startDate: ymd(monday),
      endDate: ymd(addDays(monday, 4)),
      clients: new Map(),
      tasks: []
    })
  }
  return planWeeks.get(key)
}

function ensureClientWeek(bucket, item, nextOwner) {
  if (!bucket.clients.has(item.clientSlug)) {
    const humanOrderId = `ho-${item.year}-w${bucket.week}-${item.clientSlug}`
    const plannerId = `pl-${item.year}-w${bucket.week}-${item.clientSlug}`
    bucket.clients.set(item.clientSlug, {
      clientSlug: item.clientSlug,
      clientName: item.clientName,
      sourceRanges: new Set(),
      deliverables: {},
      counters: {},
      units: [],
      humanOrderId,
      plannerId,
      plannerOwner: nextOwner('planner')
    })
  }
  return bucket.clients.get(item.clientSlug)
}

function buildPlan(normalized, agentPools) {
  const nextOwner = createOwnerAssigner(agentPools)
  const planId = safePlanId(normalized.label, normalized.sourcePath)
  const weeks = new Map()

  for (const item of normalized.items) {
    for (let week = item.startWeek; week <= item.endWeek; week += 1) {
      const bucket = ensureWeekBucket(weeks, item.year, week)
      const clientWeek = ensureClientWeek(bucket, item, nextOwner)
      clientWeek.sourceRanges.add(`Week ${item.startWeek}-${item.endWeek}`)
      clientWeek.deliverables[item.contentType] = (clientWeek.deliverables[item.contentType] ?? 0) + item.quantity

      for (let count = 0; count < item.quantity; count += 1) {
        const nextIndex = (clientWeek.counters[item.contentType] ?? 0) + 1
        clientWeek.counters[item.contentType] = nextIndex
        const unitId = `${item.year}-w${week}-${item.clientSlug}-${item.contentType}-${String(nextIndex).padStart(2, '0')}`
        const dates = scheduleDates(item.year, week, clientWeek.units.length)

        clientWeek.units.push({
          unitId,
          contentType: item.contentType,
          contentLabel: contentTypeLabel(item.contentType),
          itemIndex: nextIndex,
          owners: {
            researcher: nextOwner('researcher'),
            writer: nextOwner('writer'),
            qc: nextOwner('qc'),
            publisher: nextOwner('publisher')
          },
          dates
        })
      }
    }
  }

  const manifestWeeks = Array.from(weeks.values())
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.week - b.week))
    .map((bucket) => {
      const weekTasks = []
      const manifestClients = Array.from(bucket.clients.values())
        .sort((a, b) => a.clientName.localeCompare(b.clientName))
        .map((clientWeek) => {
          weekTasks.push({
            id: clientWeek.humanOrderId,
            type: 'human_order',
            stage: 'human-order',
            client_slug: clientWeek.clientSlug,
            title: `Week ${bucket.week} - ${clientWeek.clientName}`,
            description: `Human order for ${clientWeek.clientName}. Source ranges: ${Array.from(clientWeek.sourceRanges).sort().join(', ')}`,
            week: bucket.week,
            owner: 'human',
            status: 'planned',
            priority: 'normal',
            parent_id: null,
            plan_id: planId,
            source_input: normalized.sourcePath,
            source_type: normalized.sourceType,
            research_date: null,
            writer_date: null,
            qc_date: null,
            publish_date: null,
            eta: bucket.endDate
          })

          weekTasks.push({
            id: clientWeek.plannerId,
            type: 'plan_artifact',
            stage: 'planner',
            client_slug: clientWeek.clientSlug,
            title: `Week ${bucket.week} Plan - ${clientWeek.clientName}`,
            description: `Planned deliverables -> ${describeDeliverables(clientWeek.deliverables)}`,
            week: bucket.week,
            owner: clientWeek.plannerOwner,
            status: 'planned',
            priority: 'high',
            parent_id: clientWeek.humanOrderId,
            plan_id: planId,
            source_input: normalized.sourcePath,
            source_type: normalized.sourceType,
            deliverables: clientWeek.deliverables,
            research_date: bucket.startDate,
            writer_date: bucket.startDate,
            qc_date: bucket.endDate,
            publish_date: bucket.endDate,
            eta: bucket.endDate
          })

          clientWeek.units.forEach((unit) => {
            const suffix = `${unit.contentType}-${String(unit.itemIndex).padStart(2, '0')}`
            const taskLabel = `${unit.contentLabel} #${unit.itemIndex}`

            const researchId = `rs-${unit.unitId}`
            const writerId = `wr-${unit.unitId}`
            const qcId = `qc-${unit.unitId}`
            const publishId = `pb-${unit.unitId}`

            weekTasks.push({
              id: researchId,
              type: 'research_pack',
              stage: 'researcher',
              client_slug: clientWeek.clientSlug,
              content_type: unit.contentType,
              title: `Research ${taskLabel} - ${clientWeek.clientName}`,
              description: `Research package for ${taskLabel}. Planned by ${clientWeek.plannerOwner}.`,
              week: bucket.week,
              owner: unit.owners.researcher,
              status: 'queued',
              priority: 'normal',
              parent_id: clientWeek.plannerId,
              plan_id: planId,
              deliverable_key: suffix,
              source_input: normalized.sourcePath,
              source_type: normalized.sourceType,
              eta: unit.dates.eta,
              research_date: unit.dates.research_date,
              writer_date: unit.dates.writer_date,
              qc_date: unit.dates.qc_date,
              publish_date: unit.dates.publish_date
            })

            weekTasks.push({
              id: writerId,
              type: 'draft',
              stage: 'writer',
              client_slug: clientWeek.clientSlug,
              content_type: unit.contentType,
              title: `Write ${taskLabel} - ${clientWeek.clientName}`,
              description: `Draft ${taskLabel} after research handoff.`,
              week: bucket.week,
              owner: unit.owners.writer,
              status: 'queued',
              priority: 'normal',
              parent_id: researchId,
              plan_id: planId,
              deliverable_key: suffix,
              source_input: normalized.sourcePath,
              source_type: normalized.sourceType,
              eta: unit.dates.eta,
              research_date: unit.dates.research_date,
              writer_date: unit.dates.writer_date,
              qc_date: unit.dates.qc_date,
              publish_date: unit.dates.publish_date
            })

            weekTasks.push({
              id: qcId,
              type: 'qc_report',
              stage: 'qc',
              client_slug: clientWeek.clientSlug,
              content_type: unit.contentType,
              title: `QC ${taskLabel} - ${clientWeek.clientName}`,
              description: `Quality review for ${taskLabel}.`,
              week: bucket.week,
              owner: unit.owners.qc,
              status: 'queued',
              priority: 'normal',
              parent_id: writerId,
              plan_id: planId,
              deliverable_key: suffix,
              source_input: normalized.sourcePath,
              source_type: normalized.sourceType,
              eta: unit.dates.eta,
              research_date: unit.dates.research_date,
              writer_date: unit.dates.writer_date,
              qc_date: unit.dates.qc_date,
              publish_date: unit.dates.publish_date
            })

            weekTasks.push({
              id: publishId,
              type: 'publish_bundle',
              stage: 'publisher',
              client_slug: clientWeek.clientSlug,
              content_type: unit.contentType,
              title: `Publish ${taskLabel} - ${clientWeek.clientName}`,
              description: `Publish-ready bundle for ${taskLabel}.`,
              week: bucket.week,
              owner: unit.owners.publisher,
              status: 'queued',
              priority: 'normal',
              parent_id: qcId,
              plan_id: planId,
              deliverable_key: suffix,
              source_input: normalized.sourcePath,
              source_type: normalized.sourceType,
              eta: unit.dates.eta,
              research_date: unit.dates.research_date,
              writer_date: unit.dates.writer_date,
              qc_date: unit.dates.qc_date,
              publish_date: unit.dates.publish_date
            })
          })

          return {
            clientSlug: clientWeek.clientSlug,
            clientName: clientWeek.clientName,
            sourceRanges: Array.from(clientWeek.sourceRanges).sort(),
            deliverables: clientWeek.deliverables,
            plannerOwner: clientWeek.plannerOwner,
            units: clientWeek.units
          }
        })

      bucket.tasks = weekTasks.sort(compareTasks)
      return {
        year: bucket.year,
        week: bucket.week,
        startDate: bucket.startDate,
        endDate: bucket.endDate,
        clients: manifestClients,
        workloadByOwner: buildWorkloadSummary(bucket.tasks),
        tasks: bucket.tasks
      }
    })

  return {
    schema_version: 1,
    planId,
    label: normalized.label,
    source: {
      type: normalized.sourceType,
      path: normalized.sourcePath
    },
    generatedAt: new Date().toISOString(),
    agentPools,
    totalItems: normalized.items.length,
    totalTasks: manifestWeeks.reduce((sum, week) => sum + week.tasks.length, 0),
    registry: buildRegistry(normalized),
    weeks: manifestWeeks
  }
}

function compareTasks(a, b) {
  const weekDelta = asInt(a.week, 0) - asInt(b.week, 0)
  if (weekDelta !== 0) return weekDelta
  const clientDelta = String(a.client_slug || '').localeCompare(String(b.client_slug || ''))
  if (clientDelta !== 0) return clientDelta
  const stageDelta = (STAGE_RANK.get(a.stage) ?? 999) - (STAGE_RANK.get(b.stage) ?? 999)
  if (stageDelta !== 0) return stageDelta
  return String(a.title || a.id || '').localeCompare(String(b.title || b.id || ''))
}

function buildWorkloadSummary(tasks) {
  const owners = {}
  for (const task of tasks) {
    const owner = String(task.owner || 'unassigned')
    if (!owners[owner]) {
      owners[owner] = {
        total: 0,
        byStage: {}
      }
    }
    owners[owner].total += 1
    owners[owner].byStage[task.stage] = (owners[owner].byStage[task.stage] ?? 0) + 1
  }
  return owners
}

function simplifyKanbanTask(task) {
  return {
    id: task.id,
    type: task.type,
    stage: task.stage,
    status: task.status,
    title: task.title,
    owner: task.owner,
    artifact_path: task.artifact_path
  }
}

function buildClientsView(tasks) {
  const clients = {}
  for (const task of tasks) {
    const clientSlug = cleanSlug(task.client_slug)
    if (!clientSlug) continue
    if (!clients[clientSlug]) clients[clientSlug] = { tasks: [] }
    clients[clientSlug].tasks.push(task)
  }
  return clients
}

function readWeekState(week, year) {
  const filePath = path.resolve(FF_STATE_DIR, `week${week}.json`)
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      state: {
        schema_version: 4,
        year,
        week,
        columns: STAGES,
        updatedAt: '',
        tasks: [],
        clients: {},
        kanban: { tasks: {} }
      }
    }
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    path: filePath,
    state: parsed
  }
}

function mergeWeekState(existingState, generatedTasks, year, week, planId) {
  const existingTasks = Array.isArray(existingState.tasks) ? existingState.tasks : []
  const retainedTasks = existingTasks.filter((task) => task.plan_id !== planId)
  const mergedById = new Map(retainedTasks.map((task) => [task.id, task]))
  for (const task of generatedTasks) {
    mergedById.set(task.id, task)
  }
  const mergedTasks = Array.from(mergedById.values()).sort(compareTasks)
  return {
    ...existingState,
    schema_version: Math.max(asInt(existingState.schema_version, 0), 4),
    year,
    week,
    columns: STAGES,
    updatedAt: new Date().toISOString(),
    tasks: mergedTasks,
    clients: buildClientsView(mergedTasks),
    kanban: {
      tasks: Object.fromEntries(mergedTasks.map((task, index) => [String(index), simplifyKanbanTask(task)]))
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writePlanOutputs(plan, normalized, shouldWrite) {
  const planDir = path.resolve(PROCESSED_DIR, plan.planId)
  const normalizedPath = path.resolve(planDir, 'normalized-order.json')
  const planPath = path.resolve(planDir, 'agent-distribution.json')
  const summaryPath = path.resolve(planDir, 'summary.json')

  const summary = {
    planId: plan.planId,
    label: plan.label,
    source: plan.source,
    generatedAt: plan.generatedAt,
    totalWeeks: plan.weeks.length,
    totalTasks: plan.totalTasks,
    weeks: plan.weeks.map((week) => ({
      year: week.year,
      week: week.week,
      taskCount: week.tasks.length,
      clientCount: week.clients.length
    }))
  }

  if (shouldWrite) {
    writeJson(normalizedPath, normalized)
    writeJson(planPath, plan)
    writeJson(summaryPath, summary)
    writeJson(ORDER_SNAPSHOT_FILE, plan.registry)

    for (const week of plan.weeks) {
      const existing = readWeekState(week.week, week.year)
      const merged = mergeWeekState(existing.state, week.tasks, week.year, week.week, plan.planId)
      writeJson(existing.path, merged)
    }
  }

  return {
    planDir,
    normalizedPath,
    planPath,
    summaryPath
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = resolveInputPath(args.input)
  const normalized = readInputFile(inputPath, args.year)

  if (normalized.items.length === 0) {
    throw new Error(`No valid order items found in ${inputPath}`)
  }

  const agentPools = loadAgentPools()
  const plan = buildPlan(normalized, agentPools)
  const output = writePlanOutputs(plan, normalized, args.write)

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.write ? 'write' : 'dry-run',
        input: inputPath,
        planId: plan.planId,
        sourceType: normalized.sourceType,
        weeks: plan.weeks.map((week) => week.week),
        totalTasks: plan.totalTasks,
        output
      },
      null,
      2
    )
  )
}

main()
