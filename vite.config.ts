import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
// @ts-expect-error Runtime-only helper script; keep Vite config buildable without TS declarations.
import { isCheckTasksCommand, runCheckTasks } from './scripts/check-tasks-lib.mjs'

type CheckTasksError = { postDir: string | null; error: string }
type CheckTasksSummary = {
  ok: boolean
  generatedAt: string
  deliverablesRoot: string
  qc_run_count: number
  pass_count: number
  fail_count: number
  skipped_count: number
  errors: CheckTasksError[]
}

const WORKSPACE_ROOT = path.resolve(__dirname, '..')
const CHAT_LOG = path.resolve(__dirname, 'public', 'ff_state', 'chat_log.json')
const INBOX_DIR = path.resolve(__dirname, '..', 'human_orders', '_inbox')
const FF_STATE_DIR = path.resolve(__dirname, 'public', 'ff_state')
const ORDER_SNAPSHOT_FILE = path.resolve(FF_STATE_DIR, 'orders.json')
const CLIENTS_FILE = path.resolve(FF_STATE_DIR, 'clients.json')
const DELIVERABLES_DIR = path.resolve(WORKSPACE_ROOT, 'deliverables')
const TEXT_FILE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.html'])
const DEFAULT_CLIENT_CATALOG: Record<string, string> = {
  bed_bug_bbq: 'Bed Bug BBQ',
  bed_bugs_be_gone: 'Bed Bugs Be Gone Now',
  heat_tech_bed_bug: 'Heat Tech',
  chapman_plumbing: 'Chapman Plumbing'
}

type ChatMsg = {
  id: string
  ts: number
  author: string
  text: string
}

type ChatLog = {
  messages: ChatMsg[]
}

type ImportPayload = {
  files: Array<{ name: string; content: string }>
}

type GeneratePayload = {
  year: number
  week: number
}

type OrderPlanSummary = {
  ok: true
  startWeek: number
  endWeek: number
  plannedTotal: number
  plannedByClient: Record<string, number>
  sourceCsv: string
  generatedAt: string
}

type OrderRegistryEntry = {
  id: string
  label: string
  year: number
  startWeek: number
  endWeek: number
  plannedTotal: number
  plannedByClient: Record<string, number>
  plannedByType: Record<string, number>
}

type OrderRegistry = {
  ok: true
  sourceCsv: string
  generatedAt: string
  orders: OrderRegistryEntry[]
}

type PlannerTotals = {
  ordersCreated: number
  blogsCreated: number
  gpp: number
  l1: number
  l2: number
  l3: number
}

type DeliverablesClientSummary = PlannerTotals & {
  slug: string
  name: string
  qc: number
  artifactCount: number
  weeks: string[]
  lastUpdated: string | null
}

type ArtifactContentCategory = 'blog' | 'qc' | 'gmb' | 'l1' | 'l2' | 'l3' | 'research' | 'other'

type DeliverablesArtifact = {
  id: string
  name: string
  weekBucket: string
  weekNumbers: number[]
  clientSlug: string
  clientName: string
  artifactType: string
  contentCategory: ArtifactContentCategory
  level: 'L1' | 'L2' | 'L3' | 'OTHER'
  workflow: 'draft' | 'qc' | 'research' | 'other'
  date: string | null
  modifiedAt: string
  sizeBytes: number
  relativePath: string
}

type ClientSummaryBuilder = PlannerTotals & {
  slug: string
  name: string
  qc: number
  artifactCount: number
  weeks: Set<string>
  lastUpdatedMs: number
  actualBlogs: number
  actualGpp: number
  actualQc: number
  actualL1: number
  actualL2: number
  actualL3: number
}

function readChat(): ChatLog {
  try {
    const raw = fs.readFileSync(CHAT_LOG, 'utf8')
    const parsed = JSON.parse(raw) as ChatLog
    if (!parsed || !Array.isArray(parsed.messages)) return { messages: [] }
    return parsed
  } catch {
    return { messages: [] }
  }
}

function writeChat(log: ChatLog) {
  fs.mkdirSync(path.dirname(CHAT_LOG), { recursive: true })
  fs.writeFileSync(CHAT_LOG, JSON.stringify({ messages: log.messages.slice(-500) }, null, 2))
}

function sanitizeCsvFileName(name: string, fallback: string) {
  const base = path.basename(name || '').replace(/[^\w.-]+/g, '_')
  const withoutLeadingDot = base.replace(/^\.+/, '')
  const withName = withoutLeadingDot || fallback
  return /\.csv$/i.test(withName) ? withName : `${withName}.csv`
}

function listCsvFilesNewestFirst() {
  if (!fs.existsSync(INBOX_DIR)) return []
  const files = fs
    .readdirSync(INBOX_DIR)
    .filter((n) => n.toLowerCase().endsWith('.csv'))
    .map((name) => {
      const fullPath = path.join(INBOX_DIR, name)
      const stat = fs.statSync(fullPath)
      return { name, fullPath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files
}

function splitCsvLine(line: string) {
  const out: string[] = []
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
  return out.map((s) => s.trim())
}

function parseCsv(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return [] as Array<Record<string, string>>

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const rows: Array<Record<string, string>> = []

  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })
    rows.push(row)
  }

  return rows
}

function buildOrderPlanSummary(startWeek: number, endWeek: number): OrderPlanSummary {
  const normalizedStart = Math.max(1, Math.min(53, Math.trunc(startWeek)))
  const normalizedEnd = Math.max(1, Math.min(53, Math.trunc(endWeek)))
  const lo = Math.min(normalizedStart, normalizedEnd)
  const hi = Math.max(normalizedStart, normalizedEnd)
  const registry = getOrderRegistry()
  const matching = registry.orders.find((entry) => entry.startWeek === lo && entry.endWeek === hi)
  if (!matching) {
    return {
      ok: true,
      startWeek: lo,
      endWeek: hi,
      plannedTotal: 0,
      plannedByClient: {},
      sourceCsv: registry.sourceCsv,
      generatedAt: registry.generatedAt
    }
  }
  return {
    ok: true,
    startWeek: lo,
    endWeek: hi,
    plannedTotal: matching.plannedTotal,
    plannedByClient: matching.plannedByClient,
    sourceCsv: registry.sourceCsv,
    generatedAt: registry.generatedAt
  }
}

function buildOrderRegistry(): OrderRegistry {
  const files = listCsvFilesNewestFirst()
  const generatedAt = new Date().toISOString()
  if (files.length === 0) {
    return { ok: true, sourceCsv: '', generatedAt, orders: [] }
  }

  const currentYear = new Date().getFullYear()
  const byRange = new Map<string, OrderRegistryEntry>()
  const claimedRanges = new Set<string>()

  for (const file of files) {
    const raw = fs.readFileSync(file.fullPath, 'utf8')
    const rows = parseCsv(raw)
    const fileRanges = new Map<string, OrderRegistryEntry>()

    for (const row of rows) {
      const startWeek = asInt(row.start_week, 0)
      const endWeek = asInt(row.end_week, startWeek)
      const quantity = asInt(row.quantity, 0)
      const clientSlug = cleanSlug(row.client)
      const contentType = String(row.content_type || '').trim().toLowerCase()
      if (!startWeek || !endWeek || quantity <= 0 || !clientSlug) continue

      const lo = Math.min(startWeek, endWeek)
      const hi = Math.max(startWeek, endWeek)
      const key = `${lo}-${hi}`
      if (!fileRanges.has(key)) {
        fileRanges.set(key, {
          id: `order-week${lo}-${hi}`,
          label: `Week ${lo}-${hi}`,
          year: currentYear,
          startWeek: lo,
          endWeek: hi,
          plannedTotal: 0,
          plannedByClient: {},
          plannedByType: {}
        })
      }

      const entry = fileRanges.get(key)!
      entry.plannedTotal += quantity
      entry.plannedByClient[clientSlug] = (entry.plannedByClient[clientSlug] ?? 0) + quantity
      entry.plannedByType[contentType] = (entry.plannedByType[contentType] ?? 0) + quantity
    }

    for (const [key, entry] of fileRanges.entries()) {
      if (claimedRanges.has(key)) continue
      byRange.set(key, entry)
      claimedRanges.add(key)
    }
  }

  const orders = Array.from(byRange.values()).sort((a, b) => a.startWeek - b.startWeek)
  return {
    ok: true,
    sourceCsv: files[0].fullPath,
    generatedAt,
    orders
  }
}

function latestInboxCsvMtimeMs() {
  const files = listCsvFilesNewestFirst()
  return files[0]?.mtimeMs ?? 0
}

function orderRegistrySnapshotMtimeMs() {
  try {
    return fs.statSync(ORDER_SNAPSHOT_FILE).mtimeMs
  } catch {
    return 0
  }
}

function readOrderRegistrySnapshot(): OrderRegistry | null {
  try {
    const raw = fs.readFileSync(ORDER_SNAPSHOT_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<OrderRegistry>
    if (!parsed || !Array.isArray(parsed.orders)) return null
    return {
      ok: true,
      sourceCsv: String(parsed.sourceCsv ?? ''),
      generatedAt: String(parsed.generatedAt ?? ''),
      orders: parsed.orders as OrderRegistryEntry[]
    }
  } catch {
    return null
  }
}

function writeOrderRegistrySnapshot(registry: OrderRegistry) {
  fs.mkdirSync(FF_STATE_DIR, { recursive: true })
  fs.writeFileSync(ORDER_SNAPSHOT_FILE, `${JSON.stringify(registry, null, 2)}\n`)
}

function getOrderRegistry(): OrderRegistry {
  const snapshot = readOrderRegistrySnapshot()
  const inboxMtimeMs = latestInboxCsvMtimeMs()
  const snapshotMtimeMs = orderRegistrySnapshotMtimeMs()

  if (snapshot && snapshotMtimeMs >= inboxMtimeMs) {
    return snapshot
  }

  const freshRegistry = buildOrderRegistry()
  writeOrderRegistrySnapshot(freshRegistry)
  return freshRegistry
}

function asInt(value: unknown, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}

function cleanSlug(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function prettyClientName(slug: string) {
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function listFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  const queue: string[] = [dir]
  while (queue.length > 0) {
    const current = queue.pop()!
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      // Deliverables helper folders should not affect dashboard progress.
      if (entry.isDirectory() && entry.name === '_reports') continue
      // Pipeline markers should never surface as user-facing artifacts.
      if (entry.isDirectory() && entry.name === '.ff') continue
      if (entry.name.startsWith('.')) continue
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(abs)
      } else if (entry.isFile()) {
        out.push(abs)
      }
    }
  }
  return out
}

function parseWeekNumbers(weekBucket: string): number[] {
  // Accept optional suffixes so test buckets like `week16-16-test_1` still map to week 16.
  const match = weekBucket.match(/^week(\d{1,2})(?:-(\d{1,2}))?(?:[-_].+)?$/i)
  if (!match) return []
  const start = Math.max(1, Math.min(53, Number(match[1])))
  const end = Math.max(1, Math.min(53, Number(match[2] ?? match[1])))
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

function dateFromName(name: string) {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})_/)
  if (!match) return null
  return match[1]
}

function contentTypeForExtension(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.md') return 'text/markdown; charset=utf-8'
  if (ext === '.txt') return 'text/plain; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.csv') return 'text/csv; charset=utf-8'
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.yaml' || ext === '.yml') return 'text/yaml; charset=utf-8'
  return 'application/octet-stream'
}

function classifyLevel(category: ArtifactContentCategory): 'L1' | 'L2' | 'L3' | 'OTHER' {
  if (category === 'l1') return 'L1'
  if (category === 'l2') return 'L2'
  if (category === 'l3') return 'L3'
  return 'OTHER'
}

function classifyWorkflow(name: string, relativePath: string, artifactType: string): 'draft' | 'qc' | 'research' | 'other' {
  const lower = `${relativePath}/${name}`.toLowerCase()
  const type = artifactType.toLowerCase()

  if (type === 'research' || lower.includes('research-pack') || lower.includes('_research')) return 'research'
  if (lower.includes('_draft') || lower.includes('-draft') || lower.includes('draft_')) return 'draft'
  if (lower.includes('_qc') || lower.includes('quality-check') || lower.includes('quality_check')) return 'qc'
  return 'other'
}

function classifyContentCategory(
  name: string,
  relativePath: string,
  artifactType: string,
  workflow: 'draft' | 'qc' | 'research' | 'other'
): ArtifactContentCategory {
  const full = `${relativePath}/${name}`.toLowerCase()
  const type = artifactType.toLowerCase()

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

function readClientNames() {
  const names: Record<string, string> = {}
  try {
    const raw = fs.readFileSync(CLIENTS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { clients?: Array<{ slug?: string; name?: string }> }
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

function createPlannerTotals(): PlannerTotals {
  return { ordersCreated: 0, blogsCreated: 0, gpp: 0, l1: 0, l2: 0, l3: 0 }
}

function readPlannerTotalsByClient() {
  const totalsByClient = new Map<string, PlannerTotals>()
  if (!fs.existsSync(FF_STATE_DIR)) return totalsByClient

  const weekStateFiles = fs
    .readdirSync(FF_STATE_DIR)
    .filter((name) => /^week\d+\.json$/i.test(name))
    .sort()

  for (const stateName of weekStateFiles) {
    try {
      const raw = fs.readFileSync(path.join(FF_STATE_DIR, stateName), 'utf8')
      const parsed = JSON.parse(raw) as { tasks?: Array<Record<string, unknown>> }
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
      for (const task of tasks) {
        const slug = cleanSlug(task.client_slug)
        if (!slug) continue
        const slot = totalsByClient.get(slug) ?? createPlannerTotals()
        const type = String(task.type ?? '')
        if (type === 'human_order') {
          slot.ordersCreated += 1
        }
        if (type === 'plan_artifact' && task.deliverables && typeof task.deliverables === 'object') {
          const deliverables = task.deliverables as Record<string, unknown>
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

function createClientSummaryBuilder(slug: string, name: string): ClientSummaryBuilder {
  return {
    slug,
    name,
    ...createPlannerTotals(),
    qc: 0,
    artifactCount: 0,
    weeks: new Set<string>(),
    lastUpdatedMs: 0,
    actualBlogs: 0,
    actualGpp: 0,
    actualQc: 0,
    actualL1: 0,
    actualL2: 0,
    actualL3: 0
  }
}

function buildDeliverablesIndex() {
  const loadedClientNames = readClientNames()
  const clientNames = Object.keys(loadedClientNames).length > 0 ? loadedClientNames : DEFAULT_CLIENT_CATALOG
  const allowedClientSlugs = new Set(Object.keys(clientNames))
  const plannerTotalsByClient = readPlannerTotalsByClient()
  const artifactFiles = listFilesRecursively(DELIVERABLES_DIR)
  const summaries = new Map<string, ClientSummaryBuilder>()
  const artifacts: DeliverablesArtifact[] = []
  const weekBuckets = new Set<string>()

  for (const abs of artifactFiles) {
    const ext = path.extname(abs).toLowerCase()
    if (!TEXT_FILE_EXTENSIONS.has(ext)) continue

    const relToDeliverables = path.relative(DELIVERABLES_DIR, abs).split(path.sep).join('/')
    // Never surface pipeline markers or their JSON in any artifact feed.
    if (relToDeliverables.includes('/.ff/')) continue
    const baseNameLower = path.basename(abs).toLowerCase()
    if (baseNameLower === 'writer_done.json' || baseNameLower === 'qc_done.json') continue
    // Optional UI cleanliness: hide lint JSON artifacts.
    if (baseNameLower.endsWith('_draft_lint.json')) continue
    const parts = relToDeliverables.split('/').filter(Boolean)
    if (!parts.length) continue

    const weekBucket = parts[0] ?? 'unknown'
    const clientSlug = cleanSlug(parts[1] ?? 'unknown_client')
    const artifactType = String(parts[2] ?? 'misc').toLowerCase()
    if (!allowedClientSlugs.has(clientSlug)) continue
    const name = path.basename(abs)
    const stat = fs.statSync(abs)
    const modifiedAt = stat.mtime.toISOString()
    const date = dateFromName(name)
    const weekNumbers = parseWeekNumbers(weekBucket)
    const relativePath = path.relative(WORKSPACE_ROOT, abs).split(path.sep).join('/')
    const workflow = classifyWorkflow(name, relativePath, artifactType)
    const contentCategory = classifyContentCategory(name, relativePath, artifactType, workflow)
    const level = classifyLevel(contentCategory)

    const summary =
      summaries.get(clientSlug) ?? createClientSummaryBuilder(clientSlug, clientNames[clientSlug] ?? prettyClientName(clientSlug))
    summary.artifactCount += 1
    summary.weeks.add(weekBucket)
    summary.lastUpdatedMs = Math.max(summary.lastUpdatedMs, stat.mtimeMs)
    if (contentCategory === 'blog') summary.actualBlogs += 1
    if (contentCategory === 'gmb') summary.actualGpp += 1
    if (contentCategory === 'qc') summary.actualQc += 1
    if (contentCategory === 'l1') summary.actualL1 += 1
    if (contentCategory === 'l2') summary.actualL2 += 1
    if (contentCategory === 'l3') summary.actualL3 += 1
    summaries.set(clientSlug, summary)

    weekBuckets.add(weekBucket)
    artifacts.push({
      id: `${clientSlug}:${relToDeliverables}`,
      name,
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
      relativePath
    })
  }

  // Ensure clients that only exist in planner state still appear in the dashboard.
  for (const [slug, totals] of plannerTotalsByClient.entries()) {
    if (!allowedClientSlugs.has(slug)) continue
    if (!summaries.has(slug)) {
      summaries.set(slug, createClientSummaryBuilder(slug, clientNames[slug] ?? prettyClientName(slug)))
    }
    const summary = summaries.get(slug)!
    summary.ordersCreated += totals.ordersCreated
    summary.blogsCreated += totals.blogsCreated
    summary.gpp += totals.gpp
    summary.l1 += totals.l1
    summary.l2 += totals.l2
    summary.l3 += totals.l3
  }

  // Ensure all known clients are represented, even with zero artifacts.
  for (const slug of allowedClientSlugs) {
    if (!summaries.has(slug)) {
      summaries.set(slug, createClientSummaryBuilder(slug, clientNames[slug] ?? prettyClientName(slug)))
    }
  }

  const clients: DeliverablesClientSummary[] = Array.from(summaries.values())
    .map((summary) => {
      const inferredOrders = summary.weeks.size
      return {
        slug: summary.slug,
        name: summary.name,
        // Prefer actual filesystem outputs for client dashboard accuracy.
        ordersCreated: Math.max(summary.ordersCreated, inferredOrders),
        blogsCreated: summary.actualBlogs,
        gpp: summary.actualGpp,
        qc: summary.actualQc,
        l1: summary.actualL1,
        l2: summary.actualL2,
        l3: summary.actualL3,
        artifactCount: summary.artifactCount,
        weeks: Array.from(summary.weeks).sort((a, b) => a.localeCompare(b)),
        lastUpdated: summary.lastUpdatedMs ? new Date(summary.lastUpdatedMs).toISOString() : null
      }
    })
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

function generateWeekStateFromCsv(year: number, week: number) {
  const files = listCsvFilesNewestFirst()
  if (files.length === 0) {
    throw new Error(`No CSV files found in ${INBOX_DIR}`)
  }

  const latest = files[0]
  const raw = fs.readFileSync(latest.fullPath, 'utf8')
  const rows = parseCsv(raw)

  // CSV columns: client,start_week,end_week,content_type,quantity
  // For now we create ONLY Human Order items (Week N — Client).
  const clients = new Set<string>()

  for (const row of rows) {
    const clientSlug = cleanSlug(row.client)
    if (!clientSlug) continue

    const startWeek = asInt(row.start_week, 0)
    const endWeek = asInt(row.end_week, 0)
    const contentType = String(row.content_type || '').trim().toLowerCase()

    if (!startWeek || !endWeek) continue
    if (week < startWeek || week > endWeek) continue

    // We only execute blogs first, but HO is high-level; we still use blog_post filter to avoid link/gbp creating HO noise.
    if (contentType !== 'blog_post') continue

    clients.add(clientSlug)
  }

  const tasks = Array.from(clients)
    .sort()
    .map((client_slug) => ({
      id: `ho-${year}-w${week}-${client_slug}`,
      type: 'human_order',
      stage: 'human-order',
      client_slug,
      week,
      parent_id: null,
      title: `Week ${week} — ${client_slug}`,
      description: 'Human Order item (Week + Client). Planner will expand this into scheduled work.',
      status: 'planned',
      research_date: null,
      writer_date: null,
      qc_date: null,
      publish_date: null
    }))

  return {
    schema_version: 2,
    year,
    week,
    columns: ['human-order', 'planner', 'researcher', 'writer', 'qc', 'publisher'],
    tasks
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ff-local-bridge',
      configureServer(server) {
        server.middlewares.use('/api/generate-week-state', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}') as Partial<GeneratePayload>
              const year = Number(payload.year)
              const week = Number(payload.week)
              if (!Number.isFinite(year) || !Number.isFinite(week)) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'year and week are required' }))
                return
              }

              const state = generateWeekStateFromCsv(year, week)
              fs.mkdirSync(FF_STATE_DIR, { recursive: true })
              const outPath = path.join(FF_STATE_DIR, `week${week}.json`)
              fs.writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`)

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, outPath, tasks: state.tasks.length }))
            } catch (error) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: 'Generate week state failed',
                  details: error instanceof Error ? error.message : 'Unknown error'
                })
              )
            }
          })
        })

        server.middlewares.use('/api/import-csv', (req, res, next) => {
          if (!req.url) return next()

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const payload = JSON.parse(body) as Partial<ImportPayload>
              const files = Array.isArray(payload.files) ? payload.files : []
              if (files.length === 0) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'No files provided' }))
                return
              }

              fs.mkdirSync(INBOX_DIR, { recursive: true })

              let index = 0
              for (const file of files) {
                const safeName = sanitizeCsvFileName(file.name, `upload-${Date.now()}-${++index}.csv`)
                const content = String(file.content ?? '')
                fs.writeFileSync(path.join(INBOX_DIR, safeName), content)
              }

              // Refresh order registry snapshot for dashboards/agents.
              const registry = buildOrderRegistry()
              fs.mkdirSync(FF_STATE_DIR, { recursive: true })
              fs.writeFileSync(path.join(FF_STATE_DIR, 'orders.json'), `${JSON.stringify(registry, null, 2)}\n`)

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, filesWritten: files.length, inbox: INBOX_DIR }))
            } catch (error) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: 'CSV import failed',
                  details: error instanceof Error ? error.message : 'Unknown error'
                })
              )
            }
          })
        })

        server.middlewares.use('/api/order-plan-summary', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          try {
            const url = new URL(req.url, 'http://localhost')
            const startWeek = Number(url.searchParams.get('startWeek') || 0)
            const endWeek = Number(url.searchParams.get('endWeek') || 0)
            if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek) || startWeek <= 0 || endWeek <= 0) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'startWeek and endWeek are required' }))
              return
            }

            const payload = buildOrderPlanSummary(startWeek, endWeek)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: false,
                error: 'Failed to build order plan summary',
                details: error instanceof Error ? error.message : 'Unknown error'
              })
            )
          }
        })

        server.middlewares.use('/api/order-registry', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          try {
            const payload = getOrderRegistry()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: false,
                error: 'Failed to build order registry',
                details: error instanceof Error ? error.message : 'Unknown error'
              })
            )
          }
        })

        server.middlewares.use('/api/artifact', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          const url = new URL(req.url, 'http://localhost')
          const reqPath = String(url.searchParams.get('path') || '')
          if (!reqPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing path' }))
            return
          }

          // Only allow reads under the workspace deliverables folder.
          const abs = path.resolve(WORKSPACE_ROOT, reqPath)
          const allowedRoot = DELIVERABLES_DIR
          if (!abs.startsWith(allowedRoot + path.sep)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Forbidden path' }))
            return
          }

          if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Not found' }))
            return
          }

          const content = fs.readFileSync(abs, 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: reqPath, content }))
        })

        server.middlewares.use('/api/artifact-download', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          const url = new URL(req.url, 'http://localhost')
          const reqPath = String(url.searchParams.get('path') || '')
          if (!reqPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing path' }))
            return
          }

          const abs = path.resolve(WORKSPACE_ROOT, reqPath)
          const allowedRoot = DELIVERABLES_DIR
          if (!abs.startsWith(allowedRoot + path.sep)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Forbidden path' }))
            return
          }

          if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Not found' }))
            return
          }

          const fileName = path.basename(abs)
          const encodedName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A')
          res.statusCode = 200
          res.setHeader('Content-Type', contentTypeForExtension(abs))
          res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
          res.setHeader('Cache-Control', 'no-store')
          const buffer = fs.readFileSync(abs)
          res.end(buffer)
        })

        server.middlewares.use('/api/deliverables-index', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          try {
            const payload = buildDeliverablesIndex()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: false,
                error: 'Failed to build deliverables index',
                details: error instanceof Error ? error.message : 'Unknown error'
              })
            )
          }
        })

        server.middlewares.use('/api/check-tasks', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          try {
            const summary = runCheckTasks() as CheckTasksSummary
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(summary))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: false,
                error: 'check tasks failed',
                details: error instanceof Error ? error.message : 'Unknown error'
              })
            )
          }
        })

        server.middlewares.use('/api/locate-file', (req, res, next) => {
          if (!req.url) return next()
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}') as { path?: string }
              const reqPath = String(payload.path || '')
              if (!reqPath) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Missing path' }))
                return
              }

              const abs = path.resolve(WORKSPACE_ROOT, reqPath)
              const allowedRoot = DELIVERABLES_DIR
              if (!abs.startsWith(allowedRoot + path.sep)) {
                res.statusCode = 403
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Forbidden path' }))
                return
              }

              if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
                res.statusCode = 404
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Not found' }))
                return
              }

              if (process.platform === 'darwin') {
                const proc = spawn('open', ['-R', abs], { detached: true, stdio: 'ignore' })
                proc.unref()
              } else {
                const targetDir = path.dirname(abs)
                const command = process.platform === 'win32' ? 'explorer' : 'xdg-open'
                const args = process.platform === 'win32' ? [targetDir] : [targetDir]
                const proc = spawn(command, args, { detached: true, stdio: 'ignore' })
                proc.unref()
              }

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, path: reqPath }))
            } catch (error) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  ok: false,
                  error: 'Failed to locate file',
                  details: error instanceof Error ? error.message : 'Unknown error'
                })
              )
            }
          })
        })

        server.middlewares.use('/api/chat', (req, res, next) => {
          if (!req.url) return next()

          // GET /api/chat
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(readChat()))
            return
          }

          // POST /api/chat
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const payload = JSON.parse(body) as Partial<ChatMsg>
                const author = String(payload.author || 'Mark')
                const text = String(payload.text || '').trim()
                if (!text) {
                  res.statusCode = 400
                  res.end(JSON.stringify({ error: 'Missing text' }))
                  return
                }

                const msg: ChatMsg = {
                  id: payload.id ? String(payload.id) : `msg-${Date.now()}`,
                  ts: payload.ts ? Number(payload.ts) : Date.now(),
                  author,
                  text
                }

                const log = readChat()
                log.messages.push(msg)

                 let commandResult: CheckTasksSummary | null = null
                 if (isCheckTasksCommand(text) as boolean) {
                   commandResult = runCheckTasks() as CheckTasksSummary
                   const summaryLine = `qc_run_count=${commandResult.qc_run_count} pass_count=${commandResult.pass_count} fail_count=${commandResult.fail_count} skipped_count=${commandResult.skipped_count}`
                   const errorLines =
                     Array.isArray(commandResult.errors) && commandResult.errors.length > 0
                       ? `\nerrors:\n${commandResult.errors
                           .slice(0, 20)
                           .map((entry) => `- ${(entry.postDir ?? '(control-center-update)')}: ${entry.error}`)
                           .join('\n')}`
                       : ''
                   log.messages.push({
                     id: `cmd-${Date.now()}`,
                     ts: Date.now(),
                     author: 'OpenClaw',
                     text: `check tasks complete\n${summaryLine}${errorLines}`.trim()
                   })
                 }

                writeChat(log)

                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true, commandResult }))
              } catch {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'Invalid JSON' }))
              }
            })
            return
          }

          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
        })
      }
    }
  ]
})
