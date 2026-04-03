import { useEffect, useMemo, useState } from 'react'

export type DashboardUpdateWeek = {
  week: number
  file: string
  taskCount: number
  realTaskCount: number
  ignoredTestTaskCount: number
  mixedPlans: boolean
  planIds: string[]
  realPlanIds: string[]
  testPlanIds: string[]
}

export type DashboardUpdateEntry = {
  id: string
  kind: 'audit' | 'commit'
  severity: 'info' | 'warning' | 'success'
  timestamp: string
  title: string
  summary: string
  detail?: string
}

type DashboardUpdatesPayload = {
  ok?: boolean
  generatedAt?: string
  ordersGeneratedAt?: string
  activeOrderLabels?: string[]
  liveUpdatedAt?: string
  livePatchCount?: number
  weeks?: DashboardUpdateWeek[]
  entries?: DashboardUpdateEntry[]
}

export type DashboardUpdatesState = {
  loading: boolean
  error: string
  generatedAt: string
  ordersGeneratedAt: string
  activeOrderLabels: string[]
  liveUpdatedAt: string
  livePatchCount: number
  weeks: DashboardUpdateWeek[]
  entries: DashboardUpdateEntry[]
}

const EMPTY_STATE: DashboardUpdatesState = {
  loading: true,
  error: '',
  generatedAt: '',
  ordersGeneratedAt: '',
  activeOrderLabels: [],
  liveUpdatedAt: '',
  livePatchCount: 0,
  weeks: [],
  entries: []
}

export function useDashboardUpdates(pollIntervalMs = 15000) {
  const [state, setState] = useState<DashboardUpdatesState>(EMPTY_STATE)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const res = await fetch(`/ff_state/dashboard-updates.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('Failed to load dashboard updates')
        const payload = (await res.json()) as DashboardUpdatesPayload
        if (cancelled) return
        setState({
          loading: false,
          error: '',
          generatedAt: payload.generatedAt ?? '',
          ordersGeneratedAt: payload.ordersGeneratedAt ?? '',
          activeOrderLabels: Array.isArray(payload.activeOrderLabels) ? payload.activeOrderLabels : [],
          liveUpdatedAt: payload.liveUpdatedAt ?? '',
          livePatchCount: Number(payload.livePatchCount ?? 0),
          weeks: Array.isArray(payload.weeks) ? payload.weeks : [],
          entries: Array.isArray(payload.entries) ? payload.entries : []
        })
      } catch (error) {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load dashboard updates'
        }))
      }
    }

    void run()
    const timer = window.setInterval(() => void run(), pollIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollIntervalMs])

  return useMemo(() => state, [state])
}
