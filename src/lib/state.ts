import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveState, Stage, Task, WeekState } from './types'
import { extractTasksFromWeekState } from './weekState'
import { dataSource } from './dataSource'

export const STAGES: Stage[] = ['human-order', 'planner', 'researcher', 'writer', 'qc', 'publisher']

export const STAGE_LABEL: Record<Stage, string> = {
  'human-order': 'Human Order',
  planner: 'Planner',
  researcher: 'Researcher',
  writer: 'Writer',
  qc: 'QC',
  publisher: 'Publisher'
}

export type TaskPulse = 'created' | 'moved'

const POLL_INTERVAL_MS = 2500
const PULSE_DURATION_MS = 1400

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function applyLivePatches(tasks: Task[], live: LiveState | null) {
  if (!live?.tasks?.length) return tasks
  const patch = new Map(live.tasks.map((t) => [t.id, t]))
  return tasks.map((t) => {
    const p = patch.get(t.id)
    if (!p) return t
    return {
      ...t,
      stage: (p.stage as Stage) ?? t.stage,
      owner: p.owner ?? t.owner,
      eta: p.eta ?? t.eta,
      parent_id: p.parent_id ?? t.parent_id,
      research_date: p.research_date ?? t.research_date,
      writer_date: p.writer_date ?? t.writer_date,
      qc_date: p.qc_date ?? t.qc_date,
      publish_date: p.publish_date ?? t.publish_date
    }
  })
}

function taskSignature(task: Task) {
  const deliverables = task.deliverables
    ? Object.entries(task.deliverables).sort(([a], [b]) => a.localeCompare(b))
    : null
  return JSON.stringify({
    id: task.id,
    type: task.type ?? null,
    client_slug: task.client_slug,
    content_type: task.content_type ?? null,
    title: task.title ?? null,
    description: task.description ?? null,
    stage: task.stage,
    week: task.week ?? null,
    parent_id: task.parent_id ?? null,
    status: task.status ?? null,
    owner: task.owner ?? null,
    eta: task.eta ?? null,
    research_date: task.research_date ?? null,
    writer_date: task.writer_date ?? null,
    qc_date: task.qc_date ?? null,
    publish_date: task.publish_date ?? null,
    qc_spotcheck: task.qc_spotcheck ?? false,
    deliverables,
    artifact_path: task.artifact_path ?? null
  })
}

function boardSignature(tasks: Task[]) {
  return tasks.map(taskSignature).sort().join('|')
}

function movedFieldsChanged(prev: Task, next: Task) {
  return (
    prev.stage !== next.stage ||
    (prev.research_date ?? null) !== (next.research_date ?? null) ||
    (prev.writer_date ?? null) !== (next.writer_date ?? null) ||
    (prev.qc_date ?? null) !== (next.qc_date ?? null) ||
    (prev.publish_date ?? null) !== (next.publish_date ?? null)
  )
}

function collectTaskPulses(prev: Task[], next: Task[]): Record<string, TaskPulse> {
  const pulses: Record<string, TaskPulse> = {}
  const prevById = new Map(prev.map((task) => [task.id, task]))
  for (const task of next) {
    const oldTask = prevById.get(task.id)
    if (!oldTask) {
      pulses[task.id] = 'created'
      continue
    }
    if (movedFieldsChanged(oldTask, task)) {
      pulses[task.id] = 'moved'
    }
  }
  return pulses
}

type ClientsFile = { clients: Array<{ slug: string; name: string }> }

export function useClients() {
  const [clientNameBySlug, setClientNameBySlug] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await fetchJson<ClientsFile>('/ff_state/clients.json')
      if (cancelled || !data?.clients) return
      const map: Record<string, string> = {}
      for (const c of data.clients) map[c.slug] = c.name
      setClientNameBySlug(map)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return clientNameBySlug
}

type WeekBoardOptions = {
  weeks?: number[]
}

function normalizeWeeks(weeks: number[]) {
  const uniq = new Set<number>()
  for (const week of weeks) {
    if (!Number.isFinite(week)) continue
    uniq.add(Math.max(1, Math.min(53, Math.trunc(week))))
  }
  return Array.from(uniq).sort((a, b) => a - b)
}

export function useWeekBoard(initialWeek = 11, options: WeekBoardOptions = {}) {
  const now = new Date()
  const [year, setYear] = useState<number>(now.getFullYear())
  const [week, setWeek] = useState<number>(initialWeek)
  const [tasks, setTasks] = useState<Task[]>([])
  const tasksRef = useRef<Task[]>([])
  const signatureRef = useRef<string>(boardSignature([]))
  const pulseTimersRef = useRef<Record<string, number>>({})
  const [changePulseById, setChangePulseById] = useState<Record<string, TaskPulse>>({})
  const [lastSync, setLastSync] = useState<string>('')
  const [reloadTick, setReloadTick] = useState(0)
  const loadedWeeks = useMemo(() => {
    if (options.weeks && options.weeks.length > 0) return normalizeWeeks(options.weeks)
    return [Math.max(1, Math.min(53, Math.trunc(week)))]
  }, [options.weeks, week])
  const loadedWeeksKey = useMemo(() => loadedWeeks.join(','), [loadedWeeks])

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    const pulseTimers = pulseTimersRef.current
    return () => {
      for (const timer of Object.values(pulseTimers)) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  const queuePulses = useCallback((pulses: Record<string, TaskPulse>) => {
    const ids = Object.keys(pulses)
    if (!ids.length) return
    setChangePulseById((prev) => ({ ...prev, ...pulses }))
    for (const id of ids) {
      const oldTimer = pulseTimersRef.current[id]
      if (oldTimer) window.clearTimeout(oldTimer)
      pulseTimersRef.current[id] = window.setTimeout(() => {
        setChangePulseById((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        delete pulseTimersRef.current[id]
      }, PULSE_DURATION_MS)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const syncBoard = async () => {
      const source = dataSource()
      if (source === 'sanity') {
        const payload = await fetchJson<{ ok?: boolean; generatedAt?: string; weeks?: number[]; tasks?: Task[] }>(
          `/api/sanity/tasks?weeks=${encodeURIComponent(loadedWeeks.join(','))}&t=${Date.now()}`,
        )
        if (cancelled) return
        const nextTasks = Array.isArray(payload?.tasks) ? payload!.tasks : []
        const nextSignature = boardSignature(nextTasks)
        const prevTasks = tasksRef.current
        const hasDataChange = nextSignature !== signatureRef.current

        if (hasDataChange) {
          const pulses = collectTaskPulses(prevTasks, nextTasks)
          signatureRef.current = nextSignature
          tasksRef.current = nextTasks
          setTasks(nextTasks)
          queuePulses(pulses)
        }

        const syncStamp = payload?.generatedAt ?? (hasDataChange ? new Date().toISOString() : '')
        if (syncStamp) {
          setLastSync((prev) => (prev === syncStamp ? prev : syncStamp))
        }
        setYear(new Date().getFullYear())
        return
      }

      const [states, live] = await Promise.all([
        Promise.all(loadedWeeks.map((w) => fetchJson<WeekState>(`/ff_state/week${w}.json?t=${Date.now()}`))),
        fetchJson<LiveState>(`/ff_state/live.json?t=${Date.now()}`)
      ])
      if (cancelled) return

      const baseTasks: Task[] = []
      for (let i = 0; i < loadedWeeks.length; i += 1) {
        const fallbackWeek = loadedWeeks[i]
        const state = states[i]
        const stateTasks = extractTasksFromWeekState(state)
        if (stateTasks.length === 0) continue
        for (const task of stateTasks) {
          baseTasks.push({ ...task, week: task.week ?? fallbackWeek })
        }
      }
      const nextTasks = applyLivePatches(baseTasks, live)
      const nextSignature = boardSignature(nextTasks)
      const prevTasks = tasksRef.current
      const hasDataChange = nextSignature !== signatureRef.current

      if (hasDataChange) {
        const pulses = collectTaskPulses(prevTasks, nextTasks)
        signatureRef.current = nextSignature
        tasksRef.current = nextTasks
        setTasks(nextTasks)
        queuePulses(pulses)
      }

      const firstLoadedState = states.find((s) => s && Number.isFinite(s.year))
      setYear(firstLoadedState?.year ?? new Date().getFullYear())
      const syncStamp = live?.updatedAt ?? (hasDataChange ? new Date().toISOString() : '')
      if (syncStamp) {
        setLastSync((prev) => (prev === syncStamp ? prev : syncStamp))
      }
    }

    void syncBoard()
    const intervalId = window.setInterval(() => {
      void syncBoard()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [queuePulses, loadedWeeksKey, reloadTick, loadedWeeks])

  const totals = useMemo(() => {
    const total = tasks.length
    const byStage = Object.fromEntries(STAGES.map((s) => [s, tasks.filter((t) => t.stage === s).length])) as Record<Stage, number>
    return { total, byStage }
  }, [tasks])

  const columns = useMemo(() => {
    return STAGES.map((stage) => ({
      id: stage,
      title: STAGE_LABEL[stage],
      tasks: tasks.filter((t) => t.stage === stage)
    }))
  }, [tasks])

  const moveTask = (taskId: string, stage: Stage) => {
    setTasks((prev) => {
      let changed = false
      const next = prev.map((t) => {
        if (t.id !== taskId || t.stage === stage) return t
        changed = true
        return { ...t, stage }
      })
      if (!changed) return prev
      tasksRef.current = next
      signatureRef.current = boardSignature(next)
      queuePulses({ [taskId]: 'moved' })
      return next
    })
  }

  const reloadWeek = () => setReloadTick((n) => n + 1)

  return { year, week, setWeek, tasks, setTasks, columns, totals, lastSync, moveTask, reloadWeek, changePulseById, loadedWeeks }
}
