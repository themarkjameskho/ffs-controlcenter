import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..')

function nowIso() {
  return new Date().toISOString()
}

function normalizeCommand(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw)
}

function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmpPath, content)
  fs.renameSync(tmpPath, filePath)
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return []
  }
}

function findPostFolders(deliverablesRoot) {
  const out = []
  const queue = [deliverablesRoot]
  while (queue.length > 0) {
    const current = queue.pop()
    const entries = listDirs(current)
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === '_reports') continue
      const abs = path.join(current, entry.name)
      if (entry.name.startsWith('post_')) {
        out.push(abs)
        continue
      }
      queue.push(abs)
    }
  }
  return out
}

function qcReportFileNameFromContentBasename(contentBasename) {
  const name = String(contentBasename || '').trim()
  if (!name) return `qc_${Date.now()}_qc_v1.md`
  const withoutExt = name.replace(/\.[^.]+$/, '')
  const withoutDraftSuffix = withoutExt.replace(/_draft$/i, '')
  return `${withoutDraftSuffix}_qc_v1.md`
}

function hasH1(markdown) {
  return /^#\s+\S/m.test(markdown)
}

function wordCount(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_\-`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}

function runBasicQc(markdown) {
  const issues = []
  const trimmed = String(markdown || '').trim()
  if (!trimmed) issues.push('Content file is empty.')
  if (trimmed.length < 400) issues.push('Content is very short (< 400 chars).')
  if (!hasH1(trimmed)) issues.push('Missing H1 title (a line starting with "# ").')
  if (wordCount(trimmed) < 120) issues.push('Content is very short (< 120 words).')
  const status = issues.length === 0 ? 'pass' : 'fail'
  return { status, issues }
}

function formatQcReport({ status, issues, contentRelpath, qcRelpath }) {
  const hardGate = status === 'pass' ? 'PASS' : 'FAIL'
  const lines = [
    '# QC Report',
    '',
    `Timestamp: ${nowIso()}`,
    `Content: ${contentRelpath}`,
    `Report: ${qcRelpath}`,
    '',
    '## Checks',
    ...(issues.length === 0 ? ['- No issues found.'] : issues.map((issue) => `- ${issue}`)),
    '',
    `Hard Gate Result: ${hardGate}`,
    ''
  ]
  return lines.join('\n')
}

function resolveUnderDir(baseDir, relPath) {
  const abs = path.resolve(baseDir, relPath)
  const base = path.resolve(baseDir) + path.sep
  if (!abs.startsWith(base)) {
    throw new Error(`Refusing path escape: ${relPath}`)
  }
  return abs
}

function runControlCenterUpdate(projectRoot) {
  const nodePath = process.execPath
  const scriptPath = path.resolve(projectRoot, 'scripts', 'build-order-registry.mjs')
  const result = spawnSync(nodePath, [scriptPath], { cwd: projectRoot, encoding: 'utf8' })
  return {
    ok: result.status === 0,
    status: result.status ?? null,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  }
}

export function isCheckTasksCommand(text) {
  const cmd = normalizeCommand(text)
  return cmd === 'check tasks' || cmd === 'check task'
}

export function runCheckTasks(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : PROJECT_ROOT
  const deliverablesRoot = options.deliverablesRoot ? path.resolve(options.deliverablesRoot) : path.resolve(WORKSPACE_ROOT, 'deliverables')

  const postFolders = findPostFolders(deliverablesRoot)
  const errors = []
  let qcRunCount = 0
  let passCount = 0
  let failCount = 0
  let skippedCount = 0

  for (const postDir of postFolders) {
    const ffDir = path.join(postDir, '.ff')
    const writerDonePath = path.join(ffDir, 'writer_done.json')
    const qcDonePath = path.join(ffDir, 'qc_done.json')

    if (!fs.existsSync(writerDonePath)) {
      skippedCount += 1
      continue
    }
    if (fs.existsSync(qcDonePath)) {
      skippedCount += 1
      continue
    }

    try {
      const marker = safeReadJson(writerDonePath)
      const contentRelpath = String(marker?.content_relpath || '').trim()
      if (!contentRelpath) {
        throw new Error(`Missing content_relpath in ${writerDonePath}`)
      }

      const contentAbs = resolveUnderDir(postDir, contentRelpath)
      if (!fs.existsSync(contentAbs) || !fs.statSync(contentAbs).isFile()) {
        throw new Error(`Content file not found: ${contentAbs}`)
      }

      const contentBasename = path.basename(contentAbs)
      const qcFileName = qcReportFileNameFromContentBasename(contentBasename)
      const qcAbs = path.join(postDir, qcFileName)
      const qcRelpath = path.relative(postDir, qcAbs).split(path.sep).join('/')

      const markdown = fs.readFileSync(contentAbs, 'utf8')
      const qc = runBasicQc(markdown)
      const report = formatQcReport({ status: qc.status, issues: qc.issues, contentRelpath, qcRelpath })

      writeFileAtomic(qcAbs, report)
      const qcDonePayload = {
        stage: 'qc_done',
        qc_status: qc.status,
        qc_relpath: qcRelpath,
        timestamp: nowIso()
      }
      writeFileAtomic(qcDonePath, `${JSON.stringify(qcDonePayload, null, 2)}\n`)

      qcRunCount += 1
      if (qc.status === 'pass') passCount += 1
      else failCount += 1
    } catch (error) {
      skippedCount += 1
      errors.push({
        postDir,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const update = runControlCenterUpdate(projectRoot)
  if (!update.ok) {
    errors.push({
      postDir: null,
      error: `Control Center update failed (orders:build): status=${update.status}`
    })
  }

  return {
    ok: errors.length === 0,
    generatedAt: nowIso(),
    deliverablesRoot,
    qc_run_count: qcRunCount,
    pass_count: passCount,
    fail_count: failCount,
    skipped_count: skippedCount,
    control_center_update: {
      ok: update.ok,
      status: update.status,
      stdout: update.stdout.trim(),
      stderr: update.stderr.trim()
    },
    errors
  }
}
