import { runCheckTasks } from './check-tasks-lib.mjs'

const summary = runCheckTasks()

const lines = []
lines.push(`qc_run_count=${summary.qc_run_count} pass_count=${summary.pass_count} fail_count=${summary.fail_count} skipped_count=${summary.skipped_count}`)

if (summary.errors.length > 0) {
  lines.push('errors:')
  for (const entry of summary.errors) {
    const loc = entry.postDir ? entry.postDir : '(control-center-update)'
    lines.push(`- ${loc}: ${entry.error}`)
  }
}

console.log(lines.join('\n'))
process.exitCode = summary.ok ? 0 : 1

