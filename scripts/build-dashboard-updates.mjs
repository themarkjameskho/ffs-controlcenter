import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@sanity/client'
import dotenv from 'dotenv'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const FF_STATE_DIR = path.resolve(PROJECT_ROOT, 'public', 'ff_state')
const OUT_PATH = path.resolve(FF_STATE_DIR, 'dashboard-updates.json')
const ORDERS_PATH = path.resolve(FF_STATE_DIR, 'orders.json')
const LIVE_PATH = path.resolve(FF_STATE_DIR, 'live.json')
const ENV_LOCAL_FILE = path.resolve(PROJECT_ROOT, '.env.local')
const ENV_FILE = path.resolve(PROJECT_ROOT, '.env')

if (fs.existsSync(ENV_LOCAL_FILE)) {
  dotenv.config({ path: ENV_LOCAL_FILE })
} else if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE })
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function isTestLike(value) {
  return /(?:^|[_/-])test(?:[_/-]|\d|$)/i.test(String(value || ''))
}

function loadWeekSummaries() {
  if (!fs.existsSync(FF_STATE_DIR)) return []
  const files = fs
    .readdirSync(FF_STATE_DIR)
    .filter((name) => /^week\d+\.json$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0))

  return files.map((name) => {
    const parsed = readJson(path.join(FF_STATE_DIR, name), { tasks: [] })
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
    const testTasks = tasks.filter((task) => isTestLike(task.plan_id) || isTestLike(task.source_input))
    const realTasks = tasks.filter((task) => !isTestLike(task.plan_id) && !isTestLike(task.source_input))
    const planIds = Array.from(new Set(tasks.map((task) => String(task.plan_id || '')).filter(Boolean))).sort()
    const realPlanIds = Array.from(new Set(realTasks.map((task) => String(task.plan_id || '')).filter(Boolean))).sort()
    const testPlanIds = Array.from(new Set(testTasks.map((task) => String(task.plan_id || '')).filter(Boolean))).sort()
    return {
      week: Number(name.match(/\d+/)?.[0] ?? 0),
      file: name,
      taskCount: tasks.length,
      realTaskCount: realTasks.length,
      ignoredTestTaskCount: testTasks.length,
      mixedPlans: realPlanIds.length > 0 && testPlanIds.length > 0,
      planIds,
      realPlanIds,
      testPlanIds
    }
  })
}

function loadRecentCommits(limit = 8) {
  try {
    const output = execSync(`git log --date=iso-strict --pretty=format:%H%x09%cI%x09%s -n ${limit} -- .`, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim()
    if (!output) return []
    return output.split('\n').map((line) => {
      const [hash, committedAt, subject] = line.split('\t')
      let files = []
      try {
        const changed = execSync(`git show --name-only --format= ${hash}`, {
          cwd: PROJECT_ROOT,
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8'
        })
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, 12)
        files = changed
      } catch {
        files = []
      }
      return { id: hash.slice(0, 7), committedAt, title: subject, files }
    })
  } catch {
    return []
  }
}

function buildAuditEntries({ weekSummaries, live, orders }) {
  const entries = []
  for (const week of weekSummaries.filter((entry) => entry.mixedPlans)) {
    entries.push({
      id: `audit-mixed-week-${week.week}`,
      kind: 'audit',
      severity: 'warning',
      timestamp: new Date().toISOString(),
      title: `Week ${week.week} still has test rows mixed in`,
      summary: `The board file still contains ${week.ignoredTestTaskCount} test task${week.ignoredTestTaskCount === 1 ? '' : 's'}, so the dashboard is deliberately ignoring them and following the real production plan instead.`,
      detail: `Real plan IDs: ${week.realPlanIds.join(', ') || '—'} · Test plan IDs: ${week.testPlanIds.join(', ') || '—'}`,
      body: [
        `Week ${week.week} has both real and test plan rows in the same board file.`,
        '',
        `Real plan IDs: ${week.realPlanIds.join(', ') || '—'}`,
        `Test plan IDs: ${week.testPlanIds.join(', ') || '—'}`,
        '',
        'Current behavior:',
        '- the dashboard ignores the test rows so the production view stays stable',
        '- the underlying week JSON still needs cleanup if you want the file itself to be pure production state'
      ].join('\n'),
      relatedFiles: [`public/ff_state/${week.file}`]
    })
  }

  const livePatchCount = Array.isArray(live.tasks) ? live.tasks.length : 0
  if (livePatchCount === 0) {
    entries.push({
      id: 'audit-live-empty',
      kind: 'audit',
      severity: 'info',
      timestamp: new Date().toISOString(),
      title: 'Live patch feed is empty',
      summary: 'The dashboard is refreshing on schedule, but there are still no live operational patches being written into live.json, so production movement cannot update in real time yet.',
      detail: 'Board updates are currently coming from the week JSON snapshots only.',
      body: [
        'The UI is polling correctly, but there are no operational patches in live.json.',
        '',
        'This means production movement is not being written during the run.',
        '',
        'What Charlie/OpenClaw should do:',
        '- write stage/owner/status/date patches into public/ff_state/live.json while work is moving',
        '- keep week*.json for planned/base state',
        '- keep QC PASS as the only Done truth'
      ].join('\n'),
      relatedFiles: ['public/ff_state/live.json', 'docs/CHARLIE_DATA_REQUIREMENTS.md']
    })
  }

  const activeOrders = Array.isArray(orders.orders) ? orders.orders : []
  if (activeOrders.length > 0) {
    entries.push({
      id: 'audit-orders-active',
      kind: 'audit',
      severity: 'success',
      timestamp: orders.generatedAt || new Date().toISOString(),
      title: 'Active order windows detected',
      summary: `The current production order window${activeOrders.length === 1 ? '' : 's'} detected from orders.json ${activeOrders.map((order) => order.label).join(' · ')}.`,
      detail: `Order registry refreshed ${orders.generatedAt || '—'}.`,
      body: [
        'Current active order windows detected from orders.json:',
        ...activeOrders.map((order) => `- ${order.label} · planned total ${order.plannedTotal ?? '—'}`)
      ].join('\n'),
      relatedFiles: ['public/ff_state/orders.json']
    })
  }

  return entries
}

function buildCommitEntries(commits) {
  return commits.map((commit) => ({
    id: `commit-${commit.id}`,
    kind: 'commit',
    severity: 'info',
    timestamp: commit.committedAt,
    title: commit.title,
    summary: 'A Control Center dashboard/codebase update was applied and logged so the team can track what changed during this production window.',
    detail: `Commit ${commit.id}`,
    body: [
      `Commit ${commit.id}`,
      '',
      commit.title,
      '',
      ...(commit.files.length > 0 ? ['Affected files:', ...commit.files.map((file) => `- ${file}`)] : ['No file list captured.'])
    ].join('\n'),
    relatedFiles: commit.files
  }))
}

function sanitizeToken(token) {
  const trimmed = String(token || '').trim()
  if (!trimmed) return null
  if (/[^\x21-\x7E]/.test(trimmed)) return null
  return trimmed
}

function sanityWriteClient() {
  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET
  const apiVersion = process.env.SANITY_API_VERSION
  const token = sanitizeToken(process.env.SANITY_WRITE_TOKEN)
  if (!projectId || !dataset || !apiVersion || !token) return null
  return createClient({ projectId, dataset, apiVersion, token, useCdn: false })
}

async function syncEntriesToSanity(client, entries, generatedAt) {
  if (!client) return false
  const tx = client.transaction()
  for (const entry of entries) {
    tx.createOrReplace({
      _id: `updateLog.${entry.id}`,
      _type: 'updateLog',
      id: entry.id,
      kind: entry.kind,
      severity: entry.severity,
      title: entry.title,
      summary: entry.summary,
      detail: entry.detail ?? '',
      body: entry.body ?? '',
      timestamp: entry.timestamp,
      relatedFiles: entry.relatedFiles ?? [],
      source: 'control-center',
      generatedAt
    })
  }
  await tx.commit()
  return true
}

const orders = readJson(ORDERS_PATH, { orders: [], generatedAt: '' })
const live = readJson(LIVE_PATH, { updatedAt: '', tasks: [] })
const weeks = loadWeekSummaries()
const commits = loadRecentCommits(8)
const entries = [...buildAuditEntries({ weekSummaries: weeks, live, orders }), ...buildCommitEntries(commits)].sort((a, b) =>
  String(b.timestamp).localeCompare(String(a.timestamp)),
)

const generatedAt = new Date().toISOString()
const output = {
  ok: true,
  generatedAt,
  ordersGeneratedAt: orders.generatedAt ?? '',
  activeOrderLabels: Array.isArray(orders.orders) ? orders.orders.map((order) => order.label) : [],
  liveUpdatedAt: live.updatedAt ?? '',
  livePatchCount: Array.isArray(live.tasks) ? live.tasks.length : 0,
  weeks,
  entries
}

fs.mkdirSync(FF_STATE_DIR, { recursive: true })
fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${OUT_PATH}`)

const sanityClient = sanityWriteClient()
if (sanityClient) {
  try {
    await syncEntriesToSanity(sanityClient, entries, generatedAt)
    console.log('Synced update logs to Sanity')
  } catch (error) {
    console.warn(`Skipped Sanity sync for update logs: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}
