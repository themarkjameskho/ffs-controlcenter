import { useEffect, useMemo, useState } from 'react'
import { dataSource } from './dataSource'

export type ProductionMetricPoint = {
  key: string
  label: string
  year: number
  startWeek: number
  endWeek: number
  qcPassRate: number | null
  avgQcScore: number | null
  avgBlogWords: number | null
  avgLinkWords: number | null
  avgContentRevisions: number | null
  avgImageRevisions: number | null
}

type ProductionMetricsPayload = {
  ok?: boolean
  generatedAt?: string
  windows?: ProductionMetricPoint[]
}

export function useProductionMetrics(pollIntervalMs = 15000) {
  const [state, setState] = useState<{ loading: boolean; error: string; generatedAt: string; windows: ProductionMetricPoint[] }>({
    loading: true,
    error: '',
    generatedAt: '',
    windows: []
  })

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const source = dataSource()
        const candidates =
          source === 'sanity'
            ? [`/api/sanity/production-metrics?t=${Date.now()}`, `/ff_state/production-metrics.json?t=${Date.now()}`]
            : [`/ff_state/production-metrics.json?t=${Date.now()}`]
        let payload: ProductionMetricsPayload | null = null
        let lastError: Error | null = null
        for (const url of candidates) {
          try {
            const res = await fetch(url, { cache: 'no-store' })
            if (!res.ok) throw new Error('Failed to load production metrics')
            payload = (await res.json()) as ProductionMetricsPayload
            break
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('Failed to load production metrics')
          }
        }
        if (!payload) throw (lastError ?? new Error('Failed to load production metrics'))
        if (cancelled) return
        setState({
          loading: false,
          error: '',
          generatedAt: payload.generatedAt ?? '',
          windows: Array.isArray(payload.windows) ? payload.windows : []
        })
      } catch (error) {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load production metrics'
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
