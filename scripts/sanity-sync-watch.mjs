import chokidar from 'chokidar'
import { spawn } from 'node:child_process'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..')

const DELIVERABLES_DIR = path.resolve(WORKSPACE_ROOT, 'deliverables')
const FF_STATE_DIR = path.resolve(REPO_ROOT, 'public', 'ff_state')

const DEBOUNCE_MS = Number(process.env.SANITY_SYNC_DEBOUNCE_MS || 2500)

let pending = false
let timer = null
let running = null
let lastReason = ''

function runSync() {
  if (running) {
    pending = true
    return
  }

  running = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sanity-sync.mjs')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env
  })

  running.on('exit', (code) => {
    running = null
    if (code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`sanity-sync failed (code ${code})`)
    }
    if (pending) {
      pending = false
      runSync()
    }
  })
}

function scheduleSync(reason) {
  lastReason = reason
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    // eslint-disable-next-line no-console
    console.log(`\n[watch] change detected → syncing (${lastReason})`)
    runSync()
  }, DEBOUNCE_MS)
}

// eslint-disable-next-line no-console
console.log('Sanity watch mode')
// eslint-disable-next-line no-console
console.log(`- deliverables: ${DELIVERABLES_DIR}`)
// eslint-disable-next-line no-console
console.log(`- ff_state:     ${FF_STATE_DIR}`)
// eslint-disable-next-line no-console
console.log(`- debounce:     ${DEBOUNCE_MS}ms`)

const watcher = chokidar.watch(
  [
    path.join(DELIVERABLES_DIR, '**/*.md'),
    path.join(FF_STATE_DIR, 'clients.json'),
    path.join(FF_STATE_DIR, 'orders.json'),
    path.join(FF_STATE_DIR, 'week*.json')
  ],
  {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 100 }
  }
)

watcher.on('add', (filePath) => scheduleSync(`added ${path.basename(filePath)}`))
watcher.on('change', (filePath) => scheduleSync(`changed ${path.basename(filePath)}`))
watcher.on('unlink', (filePath) => scheduleSync(`removed ${path.basename(filePath)}`))

process.on('SIGINT', async () => {
  // eslint-disable-next-line no-console
  console.log('\n[watch] stopping...')
  await watcher.close()
  process.exit(0)
})

