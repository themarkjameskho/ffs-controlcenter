import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..')
const INBOX_DIR = path.resolve(WORKSPACE_ROOT, 'human_orders', '_inbox')
const OUT_PATH = path.resolve(PROJECT_ROOT, 'public', 'ff_state', 'orders.json')

function listCsvFilesNewestFirst() {
  if (!fs.existsSync(INBOX_DIR)) return []
  return fs
    .readdirSync(INBOX_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .map((name) => {
      const fullPath = path.join(INBOX_DIR, name)
      const stat = fs.statSync(fullPath)
      return { name, fullPath, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
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
  return out.map((v) => v.trim())
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return []

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i])
    const row = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })
    rows.push(row)
  }
  return rows
}

function cleanSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function asInt(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}

function buildOrderRegistry() {
  const files = listCsvFilesNewestFirst()
  const generatedAt = new Date().toISOString()
  if (files.length === 0) {
    return { ok: true, sourceCsv: '', generatedAt, orders: [] }
  }

  const currentYear = new Date().getFullYear()
  const byRange = new Map()
  const claimedRanges = new Set()

  for (const file of files) {
    const rows = parseCsv(fs.readFileSync(file.fullPath, 'utf8'))
    const fileRanges = new Map()

    for (const row of rows) {
      const startWeek = asInt(row.start_week, 0)
      const endWeek = asInt(row.end_week, startWeek)
      const quantity = asInt(row.quantity, 0)
      const clientSlug = cleanSlug(row.client)
      const contentType = String(row.content_type || '').trim().toLowerCase()
      if (!startWeek || !endWeek || !clientSlug || quantity <= 0) continue

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
      const entry = fileRanges.get(key)
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

  return {
    ok: true,
    sourceCsv: files[0].fullPath,
    generatedAt,
    orders: Array.from(byRange.values()).sort((a, b) => a.startWeek - b.startWeek)
  }
}

const registry = buildOrderRegistry()
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, `${JSON.stringify(registry, null, 2)}\n`)
console.log(`Wrote ${OUT_PATH}`)
