import type { Task, WeekState } from './types'

type LegacyWeekState = {
  year?: number
  week?: number
  columns?: unknown
  tasks?: unknown
  clients?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.client_slug === 'string' && typeof value.stage === 'string'
}

export function extractTasksFromWeekState(state: unknown): Task[] {
  if (!isRecord(state)) return []

  const tasks = (state as WeekState).tasks
  if (Array.isArray(tasks)) {
    return tasks.filter(isTask)
  }

  const legacy = state as LegacyWeekState
  if (!isRecord(legacy.clients)) return []

  const out: Task[] = []
  for (const entry of Object.values(legacy.clients)) {
    if (!isRecord(entry)) continue
    const clientTasks = entry.tasks
    if (!Array.isArray(clientTasks)) continue
    for (const task of clientTasks) {
      if (isTask(task)) out.push(task)
    }
  }
  return out
}

