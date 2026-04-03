import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const FF_STATE_DIR = path.resolve(PROJECT_ROOT, 'public', 'ff_state')
const OUT_PATH = path.resolve(FF_STATE_DIR, 'dashboard-updates.json')
const ORDERS_PATH = path.resolve(FF_STATE_DIR, 'orders.json')
const LIVE_PATH = path.resolve(FF_STATE_DIR, 'live.json')

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
      return { id: hash.slice(0, 7), committedAt, title: subject }
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
      summary: `${week.ignoredTestTaskCount} test task${week.ignoredTestTaskCount === 1 ? '' : 's'} are being ignored so the dashboard follows the real plan.`,
      detail: `Real plan IDs: ${week.realPlanIds.join(', ') || '—'} · Test plan IDs: ${week.testPlanIds.join(', ') || '—'}`
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
      summary: 'The dashboard refreshes on schedule, but no live task patches are being written into live.json yet.',
      detail: 'Board updates are currently coming from the week JSON snapshots only.'
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
      summary: activeOrders.map((order) => order.label).join(' · '),
      detail: `Order registry refreshed ${orders.generatedAt || '—'}.`
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
    summary: 'Control Center update applied to the dashboard/codebase.',
    detail: `Commit ${commit.id}`
  }))
}

const orders = readJson(ORDERS_PATH, { orders: [], generatedAt: '' })
const live = readJson(LIVE_PATH, { updatedAt: '', tasks: [] })
const weeks = loadWeekSummaries()
const commits = loadRecentCommits(8)
const entries = [...buildAuditEntries({ weekSummaries: weeks, live, orders }), ...buildCommitEntries(commits)].sort((a, b) =>
  String(b.timestamp).localeCompare(String(a.timestamp)),
)

const output = {
  ok: true,
  generatedAt: new Date().toISOString(),
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
