import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeliverablesArtifact, DeliverablesIndexState } from '../lib/deliverables'
import { formatArtifactType, formatWorkflow } from '../lib/deliverables'
import { isoWeekStartDate } from '../lib/date'
import { artifactDownloadUrl, locateArtifact, useArtifactPreview } from '../lib/artifact'
import type { LiveState, Stage, Task, WeekState } from '../lib/types'
import { extractTasksFromWeekState } from '../lib/weekState'
import { dataSource } from '../lib/dataSource'

type DashboardProps = {
  deliverables: DeliverablesIndexState
}

type OrderWindow = {
  year: number
  startWeek: number
  endWeek: number
  label: string
}

type WeekTaskState = {
  loading: boolean
  error: string
  tasks: Task[]
  loadedWeeks: number[]
  lastSync: string
}

type OrderRegistryEntry = {
  id: string
  label: string
  year: number
  startWeek: number
  endWeek: number
  plannedTotal: number
  plannedByClient: Record<string, number>
  plannedByType: Record<string, number>
}

type OrderRegistryState = {
  loading: boolean
  error: string
  orders: OrderRegistryEntry[]
  sourceCsv: string
  lastSync: string
}

type OrderRegistryPayload = {
  ok?: boolean
  orders?: OrderRegistryEntry[]
  sourceCsv?: string
  generatedAt?: string
}

type ClientHealthRow = {
  slug: string
  name: string
  plannedDeliverables: number
  completedDeliverables: number
  generatedTasks: number
  completedTasks: number
  expectedPct: number
  actualPct: number
  variancePct: number
  overdueCount: number
  blockerCount: number
  wipCount: number
  risk: 'at_risk' | 'watch' | 'on_track'
}

type ContentUnitQuality = {
  unitKey: string
  clientSlug: string
  draftArtifact: DeliverablesArtifact | null
  qcArtifact: DeliverablesArtifact | null
  seoScore: number | null
  readabilityScore: number | null
  imageCount: number | null
  wordCount: number | null
  revisionCount: number
  cycleHours: number | null
  qcStatus: string | null
}

type ClientQualityRow = {
  slug: string
  name: string
  unitCount: number
  avgSeo: number | null
  avgReadability: number | null
  missingImages: number
  avgCycleHours: number | null
  avgRevisions: number | null
  qcPassPct: number | null
}

type StageRadarRow = {
  stage: Stage
  label: string
  missed: number
  today: number
  tomorrow: number
}

const DEFAULT_ACTIVE_ORDER: OrderWindow = {
  year: 2026,
  startWeek: 11,
  endWeek: 15,
  label: 'Week 11-15'
}

const DEFAULT_NEXT_ORDER: OrderWindow = {
  year: 2026,
  startWeek: 16,
  endWeek: 19,
  label: 'Week 16-19'
}

const ALL_ORDERS_KEY = '__all_orders__'

const WIP_OVERLOAD_THRESHOLD = 8
const POLL_INTERVAL_MS = 5000
const DAY_MS = 24 * 60 * 60 * 1000
const STUCK_AFTER_DAYS = 3
const STAGE_RADAR_ORDER: Stage[] = ['planner', 'researcher', 'writer', 'qc', 'publisher']

const STAGE_LABEL: Record<Stage, string> = {
  'human-order': 'Human Order',
  planner: 'Planner',
  researcher: 'Researcher',
  writer: 'Writer',
  qc: 'QC',
  publisher: 'Publisher'
}

function toNumberString(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatRate(value: number) {
  return value.toFixed(2)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function safeStamp(value: string | null | undefined) {
  if (!value) return null
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp)) return null
  return stamp
}

function averageOrNull(values: number[]) {
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

function weekNumbersFor(window: OrderWindow) {
  return Array.from({ length: window.endWeek - window.startWeek + 1 }, (_, i) => window.startWeek + i)
}

function isInWindow(week: number | undefined, window: OrderWindow) {
  if (!week) return false
  return week >= window.startWeek && week <= window.endWeek
}

function orderDateRange(window: OrderWindow) {
  const start = isoWeekStartDate(window.year, window.startWeek)
  const endStart = isoWeekStartDate(window.year, window.endWeek)
  const end = new Date(endStart)
  end.setUTCDate(end.getUTCDate() + 6)
  return { start, end }
}

function localYmd(date: Date) {
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function parseYmd(value: string | null | undefined) {
  if (!value) return null
  const [yy, mm, dd] = value.split('-').map(Number)
  if (!yy || !mm || !dd) return null
  return new Date(yy, mm - 1, dd)
}

function dueDateForTask(task: Task) {
  if (task.stage === 'planner' || task.stage === 'researcher') return task.research_date ?? null
  if (task.stage === 'writer') return task.writer_date ?? null
  if (task.stage === 'qc') return task.qc_date ?? null
  if (task.stage === 'publisher') return task.publish_date ?? null
  return null
}

function isCompletedTask(task: Task, todayYmd: string) {
  const status = String(task.status ?? '').toLowerCase()
  if (status.includes('done') || status.includes('complete') || status.includes('publish') || status.includes('closed')) {
    return true
  }
  if (task.stage === 'publisher' && task.publish_date && task.publish_date <= todayYmd) {
    return true
  }
  if (task.type === 'publish_bundle') return true
  return false
}

function sumDeliverables(deliverables: Record<string, number> | undefined) {
  if (!deliverables) return 0
  return Object.values(deliverables).reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0)
}

function averagePercent(values: number[]) {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round(total / values.length)
}

function riskRank(risk: ClientHealthRow['risk']) {
  if (risk === 'at_risk') return 0
  if (risk === 'watch') return 1
  return 2
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchOrderRegistry() {
  const source = dataSource()
  if (source === 'sanity') {
    return await fetchJson<OrderRegistryPayload>(`/api/sanity/order-registry?t=${Date.now()}`)
  }
  if (source === 'static') {
    return await fetchJson<OrderRegistryPayload>(`/ff_state/orders.json?t=${Date.now()}`)
  }
  return await fetchJson<OrderRegistryPayload>(`/api/order-registry?t=${Date.now()}`)
}

function applyLivePatches(tasks: Task[], live: LiveState | null) {
  if (!live?.tasks?.length) return tasks
  const patchById = new Map(live.tasks.map((patch) => [patch.id, patch]))
  return tasks.map((task) => {
    const patch = patchById.get(task.id)
    if (!patch) return task
    return {
      ...task,
      stage: (patch.stage as Stage) ?? task.stage,
      owner: patch.owner ?? task.owner,
      eta: patch.eta ?? task.eta,
      parent_id: patch.parent_id ?? task.parent_id,
      research_date: patch.research_date ?? task.research_date,
      writer_date: patch.writer_date ?? task.writer_date,
      qc_date: patch.qc_date ?? task.qc_date,
      publish_date: patch.publish_date ?? task.publish_date
    }
  })
}

function artifactBelongsToWindow(artifact: DeliverablesArtifact, window: OrderWindow) {
  return artifact.weekNumbers.some((week) => week >= window.startWeek && week <= window.endWeek)
}

function contentUnitKeyForArtifact(artifact: DeliverablesArtifact) {
  const parts = artifact.relativePath.split('/').filter(Boolean)
  const weekBucket = parts[1] ?? artifact.weekBucket
  const clientSlug = parts[2] ?? artifact.clientSlug
  const typeBucket = parts[3] ?? artifact.artifactType
  const unitBucket = (parts[4] ?? artifact.name.replace(/\.[^.]+$/, '')).toLowerCase()
  if (!unitBucket) return null

  // Ignore non-deliverable helper packs so completion tracks real post/article units.
  if (unitBucket.startsWith('pack_') || unitBucket.startsWith('pack-')) return null

  return `${weekBucket}|${clientSlug}|${typeBucket}|${unitBucket}`
}

function formatOrderRange(window: OrderWindow) {
  const { start, end } = orderDateRange(window)
  return `${window.label} · ${formatDate(start.toISOString())} - ${formatDate(end.toISOString())}`
}

function toOrderWindow(entry: OrderRegistryEntry): OrderWindow {
  return {
    year: entry.year,
    startWeek: entry.startWeek,
    endWeek: entry.endWeek,
    label: entry.label
  }
}

function orderKey(window: OrderWindow) {
  return `${window.year}:${window.startWeek}-${window.endWeek}`
}

function computeBodyWordCount(markdown: string): number | null {
  const md = String(markdown || '')
  const start = md.search(/^##\s+body_content\s*$/m)
  if (start === -1) return null
  const rest = md.slice(start)
  const next = rest.slice('## body_content'.length).search(/^##\s+/m)
  const body = (next === -1 ? rest : rest.slice(0, '## body_content'.length + next)).replace(/^##\s+body_content\s*$/m, '')
  const cleaned = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[Internal Link:[^\]]*\]/g, ' ')
    .replace(/https?:\/\/[^\s)\]]+/g, ' ')
    .replace(/[#>*_`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.split(' ').length : 0
}

export default function Dashboard({ deliverables }: DashboardProps) {
  const [selectedArtifact, setSelectedArtifact] = useState<DeliverablesArtifact | null>(null)
  const [locateMessage, setLocateMessage] = useState('')
  const [locating, setLocating] = useState(false)
  const previewKey = selectedArtifact ? (dataSource() === 'sanity' ? selectedArtifact.id : selectedArtifact.relativePath) : null
  const preview = useArtifactPreview(previewKey)
  const publishableWordCount = preview.status === 'ready' ? computeBodyWordCount(preview.content) : null

  const [weekTaskState, setWeekTaskState] = useState<WeekTaskState>({
    loading: true,
    error: '',
    tasks: [],
    loadedWeeks: [],
    lastSync: ''
  })
  const [orderRegistryState, setOrderRegistryState] = useState<OrderRegistryState>({
    loading: true,
    error: '',
    orders: [],
    sourceCsv: '',
    lastSync: ''
  })
  const [selectedOrderView, setSelectedOrderView] = useState(orderKey(DEFAULT_ACTIVE_ORDER))

  const orderWindows = useMemo(() => {
    const windows = orderRegistryState.orders
      .map(toOrderWindow)
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.startWeek - b.startWeek))
    if (windows.length > 0) return windows
    return [DEFAULT_ACTIVE_ORDER, DEFAULT_NEXT_ORDER]
  }, [orderRegistryState.orders])

  useEffect(() => {
    setSelectedOrderView((prev) => {
      if (prev === ALL_ORDERS_KEY) return prev
      if (orderWindows.some((window) => orderKey(window) === prev)) return prev
      return orderWindows.length > 0 ? orderKey(orderWindows[0]) : ALL_ORDERS_KEY
    })
  }, [orderWindows])

  const selectedWindow = useMemo(() => {
    if (selectedOrderView === ALL_ORDERS_KEY) return null
    return orderWindows.find((window) => orderKey(window) === selectedOrderView) ?? orderWindows[0] ?? null
  }, [orderWindows, selectedOrderView])

  const selectedWindows = useMemo(() => {
    if (selectedOrderView === ALL_ORDERS_KEY) return orderWindows
    return selectedWindow ? [selectedWindow] : []
  }, [orderWindows, selectedOrderView, selectedWindow])

  const allWeeks = useMemo(() => {
    const weeks = new Set<number>()
    for (const window of orderWindows) {
      for (const week of weekNumbersFor(window)) weeks.add(week)
    }
    return Array.from(weeks).sort((a, b) => a - b)
  }, [orderWindows])

  const selectedWeeks = useMemo(() => {
    const weeks = new Set<number>()
    for (const window of selectedWindows) {
      for (const week of weekNumbersFor(window)) weeks.add(week)
    }
    return weeks
  }, [selectedWindows])

  const selectedRegistryOrders = useMemo(() => {
    if (selectedOrderView === ALL_ORDERS_KEY) return orderRegistryState.orders
    return orderRegistryState.orders.filter((order) => orderKey(toOrderWindow(order)) === selectedOrderView)
  }, [orderRegistryState.orders, selectedOrderView])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const payload = await fetchOrderRegistry()
        if (cancelled) return
        if (!payload || payload.ok === false) {
          throw new Error('Failed to load order registry')
        }
        setOrderRegistryState({
          loading: false,
          error: '',
          orders: Array.isArray(payload.orders) ? payload.orders : [],
          sourceCsv: payload.sourceCsv ?? '',
          lastSync: payload.generatedAt ?? new Date().toISOString()
        })
      } catch (error) {
        if (cancelled) return
        setOrderRegistryState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load order registry'
        }))
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        if (dataSource() === 'sanity') {
          const payload = await fetchJson<{ ok?: boolean; generatedAt?: string; tasks?: Task[] }>(
            `/api/sanity/tasks?weeks=${encodeURIComponent(allWeeks.join(','))}&t=${Date.now()}`,
          )
          if (cancelled) return
          const tasks = Array.isArray(payload?.tasks) ? payload!.tasks : []
          setWeekTaskState({
            loading: false,
            error: '',
            tasks,
            loadedWeeks: [...allWeeks],
            lastSync: payload?.generatedAt ?? new Date().toISOString()
          })
          return
        }

        const [weekStates, live] = await Promise.all([
          Promise.all(allWeeks.map((week) => fetchJson<WeekState>(`/ff_state/week${week}.json?t=${Date.now()}`))),
          fetchJson<LiveState>(`/ff_state/live.json?t=${Date.now()}`)
        ])
        if (cancelled) return

        const loadedWeeks: number[] = []
        const baseTasks: Task[] = []
        for (let i = 0; i < allWeeks.length; i += 1) {
          const week = allWeeks[i]
          const state = weekStates[i]
          const stateTasks = extractTasksFromWeekState(state)
          if (!state || stateTasks.length === 0) continue
          loadedWeeks.push(week)
          for (const task of stateTasks) {
            baseTasks.push({ ...task, week: task.week ?? week })
          }
        }

        const nextTasks = applyLivePatches(baseTasks, live)
        setWeekTaskState({
          loading: false,
          error: '',
          tasks: nextTasks,
          loadedWeeks,
          lastSync: live?.updatedAt ?? new Date().toISOString()
        })
      } catch (error) {
        if (cancelled) return
        setWeekTaskState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load order task state'
        }))
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [allWeeks])

  const taskModel = useMemo(() => {
    const now = new Date()
    const nowMs = now.getTime()
    const todayYmd = localYmd(now)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowYmd = localYmd(tomorrow)

    const activeTasks = weekTaskState.tasks.filter((task) => (task.week ? selectedWeeks.has(task.week) : false))

    const orderedWindows = [...orderWindows].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.startWeek - b.startWeek))
    const selectedWindowIndex =
      selectedOrderView === ALL_ORDERS_KEY || !selectedWindow
        ? -1
        : orderedWindows.findIndex((window) => orderKey(window) === orderKey(selectedWindow))
    const nextWindow = selectedWindowIndex >= 0 ? orderedWindows[selectedWindowIndex + 1] ?? null : null
    const nextTasks = nextWindow ? weekTaskState.tasks.filter((task) => isInWindow(task.week, nextWindow)) : []

    const csvPlannedByClient = new Map<string, number>()
    let csvPlannedTotal = 0
    for (const order of selectedRegistryOrders) {
      csvPlannedTotal += Number(order.plannedTotal ?? 0)
      for (const [clientSlug, qty] of Object.entries(order.plannedByClient ?? {})) {
        csvPlannedByClient.set(clientSlug, (csvPlannedByClient.get(clientSlug) ?? 0) + Number(qty ?? 0))
      }
    }

    const contentArtifacts = deliverables.artifacts.filter((artifact) =>
      ['blog', 'gmb', 'l1', 'l2', 'l3'].includes(artifact.contentCategory),
    )
    const activeContentArtifacts = contentArtifacts.filter((artifact) =>
      artifact.weekNumbers.some((week) => selectedWeeks.has(week)),
    )

    const activeQualityArtifacts = deliverables.artifacts.filter(
      (artifact) =>
        ['blog', 'gmb', 'l1', 'l2', 'l3', 'qc'].includes(artifact.contentCategory) &&
        artifact.weekNumbers.some((week) => selectedWeeks.has(week)),
    )
    const nextArtifacts = nextWindow
      ? deliverables.artifacts.filter((artifact) => artifactBelongsToWindow(artifact, nextWindow))
      : []

    const contentUnits = new Map<string, { clientSlug: string; modifiedMs: number; modifiedAt: string }>()
    for (const artifact of activeContentArtifacts) {
      const unitKey = contentUnitKeyForArtifact(artifact)
      if (!unitKey) continue
      const stamp = Date.parse(artifact.modifiedAt)
      if (!Number.isFinite(stamp)) continue
      const prev = contentUnits.get(unitKey)
      if (!prev || stamp > prev.modifiedMs) {
        contentUnits.set(unitKey, {
          clientSlug: artifact.clientSlug,
          modifiedMs: stamp,
          modifiedAt: artifact.modifiedAt
        })
      }
    }

    const unitDraftCount = new Map<string, number>()
    const unitLatestDraft = new Map<string, DeliverablesArtifact>()
    const unitLatestQc = new Map<string, DeliverablesArtifact>()
    for (const artifact of activeQualityArtifacts) {
      const unitKey = contentUnitKeyForArtifact(artifact)
      if (!unitKey) continue
      const stamp = safeStamp(artifact.modifiedAt) ?? 0

      if (artifact.workflow === 'draft') {
        unitDraftCount.set(unitKey, (unitDraftCount.get(unitKey) ?? 0) + 1)
        const prev = unitLatestDraft.get(unitKey)
        const prevStamp = prev ? safeStamp(prev.modifiedAt) ?? 0 : 0
        if (!prev || stamp > prevStamp) {
          unitLatestDraft.set(unitKey, artifact)
        }
      }

      if (artifact.workflow === 'qc' || artifact.contentCategory === 'qc') {
        const prev = unitLatestQc.get(unitKey)
        const prevStamp = prev ? safeStamp(prev.modifiedAt) ?? 0 : 0
        if (!prev || stamp > prevStamp) {
          unitLatestQc.set(unitKey, artifact)
        }
      }
    }

    const unitQuality: ContentUnitQuality[] = []
    for (const [unitKey, draftArtifact] of unitLatestDraft.entries()) {
      const qcArtifact = unitLatestQc.get(unitKey) ?? null
      const seoScore = typeof draftArtifact.analysis?.seoScore === 'number' ? draftArtifact.analysis.seoScore : null
      const readabilityScore =
        typeof draftArtifact.analysis?.readabilityScore === 'number' ? draftArtifact.analysis.readabilityScore : null
      const imageCount = typeof draftArtifact.analysis?.imageCount === 'number' ? draftArtifact.analysis.imageCount : null
      const wordCount = typeof draftArtifact.analysis?.wordCount === 'number' ? draftArtifact.analysis.wordCount : null
      const revisionCount =
        typeof draftArtifact.markers?.revisionCount === 'number'
          ? draftArtifact.markers.revisionCount
          : typeof qcArtifact?.markers?.revisionCount === 'number'
            ? qcArtifact.markers.revisionCount
            : unitDraftCount.get(unitKey) ?? 1
      const qcStatus =
        (draftArtifact.markers?.qcStatus ? String(draftArtifact.markers.qcStatus) : null) ??
        (qcArtifact?.markers?.qcStatus ? String(qcArtifact.markers.qcStatus) : null) ??
        null

      const writerDoneStamp = safeStamp(draftArtifact.markers?.writerDoneAt ?? null)
      const qcDoneStamp = safeStamp(draftArtifact.markers?.qcDoneAt ?? null) ?? safeStamp(qcArtifact?.markers?.qcDoneAt ?? null)
      const draftStamp = safeStamp(draftArtifact.modifiedAt)
      const qcStamp = safeStamp(qcArtifact?.modifiedAt ?? null)

      let cycleHours: number | null = null
      if (writerDoneStamp && qcDoneStamp && qcDoneStamp >= writerDoneStamp) {
        cycleHours = Math.round(((qcDoneStamp - writerDoneStamp) / (60 * 60 * 1000)) * 10) / 10
      } else if (draftStamp && qcStamp && qcStamp >= draftStamp) {
        cycleHours = Math.round(((qcStamp - draftStamp) / (60 * 60 * 1000)) * 10) / 10
      }

      unitQuality.push({
        unitKey,
        clientSlug: draftArtifact.clientSlug,
        draftArtifact,
        qcArtifact,
        seoScore,
        readabilityScore,
        imageCount,
        wordCount,
        revisionCount,
        cycleHours,
        qcStatus
      })
    }

    const unitQualityByClient = new Map<string, ContentUnitQuality[]>()
    for (const unit of unitQuality) {
      const list = unitQualityByClient.get(unit.clientSlug) ?? []
      list.push(unit)
      unitQualityByClient.set(unit.clientSlug, list)
    }

    let lastWrittenAt: string | null = null
    let lastWrittenMs = 0
    for (const unit of contentUnits.values()) {
      if (unit.modifiedMs > lastWrittenMs) {
        lastWrittenMs = unit.modifiedMs
        lastWrittenAt = unit.modifiedAt
      }
    }

    const completedDeliverablesByClient = new Map<string, number>()
    let doneTodayCount = 0
    for (const unit of contentUnits.values()) {
      completedDeliverablesByClient.set(unit.clientSlug, (completedDeliverablesByClient.get(unit.clientSlug) ?? 0) + 1)
      if (localYmd(new Date(unit.modifiedMs)) === todayYmd) {
        doneTodayCount += 1
      }
    }

    const plannedDeliverablesByClient = new Map<string, number>()
    const generatedTasksByClient = new Map<string, number>()
    const completedTasksByClient = new Map<string, number>()
    const overdueByClient = new Map<string, number>()
    const blockersByClient = new Map<string, number>()
    const wipByClient = new Map<string, number>()

    const stageRadar = new Map<Stage, StageRadarRow>()
    for (const stage of STAGE_RADAR_ORDER) {
      stageRadar.set(stage, {
        stage,
        label: STAGE_LABEL[stage],
        missed: 0,
        today: 0,
        tomorrow: 0
      })
    }

    const overdueTasks: Task[] = []
    const stuckTasks: Array<{ task: Task; due: string }> = []
    let blockerCount = 0
    let overdueCount = 0

    for (const task of activeTasks) {
      const clientSlug = task.client_slug

      if (task.type === 'plan_artifact') {
        const planned = sumDeliverables(task.deliverables)
        if (planned > 0) {
          plannedDeliverablesByClient.set(clientSlug, (plannedDeliverablesByClient.get(clientSlug) ?? 0) + planned)
        }
      }

      if (task.type !== 'human_order') {
        generatedTasksByClient.set(clientSlug, (generatedTasksByClient.get(clientSlug) ?? 0) + 1)
      }

      const completed = isCompletedTask(task, todayYmd)
      if (completed && task.type !== 'human_order') {
        completedTasksByClient.set(clientSlug, (completedTasksByClient.get(clientSlug) ?? 0) + 1)
      }

      const blocked = String(task.status ?? '').toLowerCase().includes('block')
      if (blocked) {
        blockersByClient.set(clientSlug, (blockersByClient.get(clientSlug) ?? 0) + 1)
        blockerCount += 1
      }

      if (!completed && task.type !== 'human_order') {
        wipByClient.set(clientSlug, (wipByClient.get(clientSlug) ?? 0) + 1)
      }

      const due = dueDateForTask(task)
      if (!due || completed) continue

      const radar = stageRadar.get(task.stage)
      if (due < todayYmd) {
        overdueByClient.set(clientSlug, (overdueByClient.get(clientSlug) ?? 0) + 1)
        overdueCount += 1
        overdueTasks.push(task)
        if (radar) radar.missed += 1

        const dueDate = parseYmd(due)
        if (dueDate) {
          const ageDays = Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS)
          if (ageDays >= STUCK_AFTER_DAYS) {
            stuckTasks.push({ task, due })
          }
        }
      } else if (due === todayYmd) {
        if (radar) radar.today += 1
      } else if (due === tomorrowYmd) {
        if (radar) radar.tomorrow += 1
      }
    }

    const knownClientNames = new Map(deliverables.clients.map((client) => [client.slug, client.name]))
    const rowClientSlugs = new Set<string>()
    for (const task of activeTasks) rowClientSlugs.add(task.client_slug)
    for (const slug of completedDeliverablesByClient.keys()) rowClientSlugs.add(slug)
    for (const slug of plannedDeliverablesByClient.keys()) rowClientSlugs.add(slug)
    for (const slug of generatedTasksByClient.keys()) rowClientSlugs.add(slug)
    for (const slug of csvPlannedByClient.keys()) rowClientSlugs.add(slug)

    const clientQualityRows: ClientQualityRow[] = Array.from(unitQualityByClient.entries())
      .map(([slug, units]) => {
        const seoValues = units.map((u) => u.seoScore).filter((v): v is number => typeof v === 'number')
        const readabilityValues = units.map((u) => u.readabilityScore).filter((v): v is number => typeof v === 'number')
        const cycleValues = units.map((u) => u.cycleHours).filter((v): v is number => typeof v === 'number')
        const revisionValues = units.map((u) => u.revisionCount).filter((v): v is number => typeof v === 'number')
        const missingImages = units.filter((u) => typeof u.imageCount === 'number' && u.imageCount <= 0).length
        const qcDoneCount = units.filter((u) => (u.qcStatus ? true : false)).length
        const qcPassCount = units.filter((u) => String(u.qcStatus ?? '').toLowerCase() === 'pass').length
        const qcPassPct = qcDoneCount > 0 ? Math.round((qcPassCount / qcDoneCount) * 100) : null

        return {
          slug,
          name: knownClientNames.get(slug) ?? slug.replace(/[_-]+/g, ' '),
          unitCount: units.length,
          avgSeo: averageOrNull(seoValues),
          avgReadability: averageOrNull(readabilityValues),
          missingImages,
          avgCycleHours: cycleValues.length ? Math.round((cycleValues.reduce((sum, v) => sum + v, 0) / cycleValues.length) * 10) / 10 : null,
          avgRevisions: revisionValues.length ? Math.round((revisionValues.reduce((sum, v) => sum + v, 0) / revisionValues.length) * 10) / 10 : null,
          qcPassPct
        }
      })
      .sort((a, b) => {
        const aSeo = a.avgSeo ?? -1
        const bSeo = b.avgSeo ?? -1
        if (aSeo !== bSeo) return aSeo - bSeo
        if (a.missingImages !== b.missingImages) return b.missingImages - a.missingImages
        return a.name.localeCompare(b.name)
      })

    const windowsForDateRange = selectedWindows.length > 0 ? selectedWindows : [DEFAULT_ACTIVE_ORDER]
    let start = orderDateRange(windowsForDateRange[0]).start
    let end = orderDateRange(windowsForDateRange[0]).end
    for (const window of windowsForDateRange.slice(1)) {
      const range = orderDateRange(window)
      if (range.start.getTime() < start.getTime()) start = range.start
      if (range.end.getTime() > end.getTime()) end = range.end
    }
    const startMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const totalDays = Math.max(1, Math.floor((endMs - startMs) / DAY_MS) + 1)
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.floor((todayMs - startMs) / DAY_MS) + 1))
    const expectedPct = Math.round((elapsedDays / totalDays) * 100)

    const clientRows: ClientHealthRow[] = Array.from(rowClientSlugs)
      .map((slug) => {
        const plannedDeliverables = csvPlannedByClient.get(slug) ?? plannedDeliverablesByClient.get(slug) ?? 0
        const completedDeliverables = completedDeliverablesByClient.get(slug) ?? 0
        const generatedTasks = generatedTasksByClient.get(slug) ?? 0
        const completedTasks = completedTasksByClient.get(slug) ?? 0
        const overdue = overdueByClient.get(slug) ?? 0
        const blockers = blockersByClient.get(slug) ?? 0
        const wip = wipByClient.get(slug) ?? 0

        const deliverablePct = plannedDeliverables > 0 ? Math.round((completedDeliverables / plannedDeliverables) * 100) : null
        const taskPct = generatedTasks > 0 ? Math.round((completedTasks / generatedTasks) * 100) : null
        const pctParts: number[] = []
        if (deliverablePct !== null) pctParts.push(deliverablePct)
        if (taskPct !== null) pctParts.push(taskPct)
        const actualPct = averagePercent(pctParts)
        const variancePct = actualPct - expectedPct

        let risk: ClientHealthRow['risk'] = 'on_track'
        if (overdue > 0 || wip > WIP_OVERLOAD_THRESHOLD) {
          risk = 'at_risk'
        } else if (actualPct + 5 < expectedPct) {
          risk = 'watch'
        }

        return {
          slug,
          name: knownClientNames.get(slug) ?? slug.replace(/[_-]+/g, ' '),
          plannedDeliverables,
          completedDeliverables,
          generatedTasks,
          completedTasks,
          expectedPct,
          actualPct,
          variancePct,
          overdueCount: overdue,
          blockerCount: blockers,
          wipCount: wip,
          risk
        }
      })
      .sort((a, b) => {
        const riskDiff = riskRank(a.risk) - riskRank(b.risk)
        if (riskDiff !== 0) return riskDiff
        if (a.variancePct !== b.variancePct) return a.variancePct - b.variancePct
        return a.name.localeCompare(b.name)
      })

    const atRiskCount = clientRows.filter((row) => row.risk === 'at_risk').length
    const onTrackCount = clientRows.filter((row) => row.risk === 'on_track').length
    const watchCount = clientRows.filter((row) => row.risk === 'watch').length
    const overloadedClients = clientRows.filter((row) => row.wipCount > WIP_OVERLOAD_THRESHOLD)
    const activeHealthAvgPct = averagePercent(clientRows.map((row) => row.actualPct))
    const totalDoneRaw = contentUnits.size
    const totalPlanned = csvPlannedTotal > 0 ? csvPlannedTotal : clientRows.reduce((sum, row) => sum + row.plannedDeliverables, 0)
    const progressDone = totalPlanned > 0 ? Math.min(totalDoneRaw, totalPlanned) : totalDoneRaw
    const progressPct = totalPlanned > 0 ? Math.round((progressDone / totalPlanned) * 100) : 0
    const remainingCount = Math.max(0, totalPlanned - progressDone)
    const overCompletedCount = totalPlanned > 0 ? Math.max(0, totalDoneRaw - totalPlanned) : 0

    const elapsedHours = Math.max(1, (nowMs - start.getTime()) / (60 * 60 * 1000))
    const averageWrittenPerHour = contentUnits.size / elapsedHours
    const productionActive = activeTasks.some(
      (task) => ['writer', 'qc', 'publisher'].includes(task.stage) && !isCompletedTask(task, todayYmd),
    )

    const overallSeo = averageOrNull(unitQuality.map((u) => u.seoScore).filter((v): v is number => typeof v === 'number'))
    const overallReadability = averageOrNull(
      unitQuality.map((u) => u.readabilityScore).filter((v): v is number => typeof v === 'number'),
    )
    const overallCycleValues = unitQuality.map((u) => u.cycleHours).filter((v): v is number => typeof v === 'number')
    const overallCycleHours =
      overallCycleValues.length > 0
        ? Math.round((overallCycleValues.reduce((sum, v) => sum + v, 0) / overallCycleValues.length) * 10) / 10
        : null
    const overallMissingImages = unitQuality.filter((u) => typeof u.imageCount === 'number' && u.imageCount <= 0).length
    const lowQualityUnits = [...unitQuality]
      .filter((u) => u.seoScore !== null || u.readabilityScore !== null)
      .sort((a, b) => {
        const aSeo = a.seoScore ?? 101
        const bSeo = b.seoScore ?? 101
        if (aSeo !== bSeo) return aSeo - bSeo
        const aRead = a.readabilityScore ?? 101
        const bRead = b.readabilityScore ?? 101
        return aRead - bRead
      })
      .slice(0, 10)

    return {
      expectedPct,
      activeHealthAvgPct,
      onTrackCount,
      atRiskCount,
      watchCount,
      progressPct,
      doneTodayCount,
      totalDoneRaw,
      progressDone,
      totalPlanned,
      remainingCount,
      overCompletedCount,
      blockerCount,
      overdueCount,
      activeTasks,
      nextTasks,
      nextArtifactsCount: nextArtifacts.length,
      nextOrderLabel: nextWindow?.label ?? '',
      nextOrderUploaded: !!nextWindow && (nextTasks.length > 0 || nextArtifacts.length > 0),
      productionActive,
      averageWrittenPerHour,
      writtenCount: contentUnits.size,
      lastWrittenAt,
      clientRows,
      stageRadarRows: STAGE_RADAR_ORDER.map((stage) => stageRadar.get(stage)!),
      overloadedClients,
      stuckTasks: stuckTasks.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 10),
      overdueTasksCount: overdueTasks.length,
      todayYmd,
      tomorrowYmd,
      clientQualityRows,
      qualitySnapshot: {
        unitCount: unitQuality.length,
        overallSeo,
        overallReadability,
        overallCycleHours,
        overallMissingImages
      },
      lowQualityUnits
    }
  }, [
    deliverables.artifacts,
    deliverables.clients,
    weekTaskState.tasks,
    selectedWeeks,
    selectedRegistryOrders,
    orderWindows,
    selectedOrderView,
    selectedWindow,
    selectedWindows
  ])

  const recentArtifacts = useMemo(() => {
    return deliverables.artifacts.slice(0, 14)
  }, [deliverables.artifacts])

  const selectedOrderLabel = selectedOrderView === ALL_ORDERS_KEY ? 'All Orders' : selectedWindow?.label ?? DEFAULT_ACTIVE_ORDER.label
  const sourceCsvName = orderRegistryState.sourceCsv.split('/').pop() || orderRegistryState.sourceCsv
  const selectedOrderRangeText = useMemo(() => {
    if (selectedOrderView !== ALL_ORDERS_KEY) {
      return formatOrderRange(selectedWindow ?? DEFAULT_ACTIVE_ORDER)
    }
    if (orderWindows.length === 0) return 'All Orders'
    let start = orderDateRange(orderWindows[0]).start
    let end = orderDateRange(orderWindows[0]).end
    for (const window of orderWindows.slice(1)) {
      const range = orderDateRange(window)
      if (range.start.getTime() < start.getTime()) start = range.start
      if (range.end.getTime() > end.getTime()) end = range.end
    }
    return `All Orders · ${formatDate(start.toISOString())} - ${formatDate(end.toISOString())}`
  }, [orderWindows, selectedOrderView, selectedWindow])

  return (
    <div className="page-shell dashboard-shell">
      <header className="page-head dashboard-hero">
        <div>
          <h1>Operational Dashboard</h1>
          <p className="subhead">{selectedOrderRangeText}</p>
        </div>
        <div className="masthead-meta">
          <label className="meta-pill dashboard-order-select">
            Order
            <select value={selectedOrderView} onChange={(event) => setSelectedOrderView(event.target.value)}>
              <option value={ALL_ORDERS_KEY}>All Orders</option>
              {orderWindows.map((window) => (
                <option key={orderKey(window)} value={orderKey(window)}>
                  {window.label}
                </option>
              ))}
            </select>
          </label>
          <span className="meta-pill">Scan: {formatDateTime(deliverables.generatedAt || null)}</span>
          <span className="meta-pill">Task Sync: {formatDateTime(weekTaskState.lastSync || null)}</span>
        </div>
      </header>

      {deliverables.loading || weekTaskState.loading || orderRegistryState.loading ? <p className="subhead">Refreshing order metrics…</p> : null}
      {deliverables.error ? <p className="subhead">{deliverables.error}</p> : null}
      {weekTaskState.error ? <p className="subhead">{weekTaskState.error}</p> : null}
      {orderRegistryState.error ? <p className="subhead">{orderRegistryState.error}</p> : null}
      {orderRegistryState.sourceCsv ? <p className="subhead">Plan source: {sourceCsvName}</p> : null}

      <section className="summary-row">
        <article>
          <p>Order Progress</p>
          <h2>
            {toNumberString(taskModel.progressDone)} / {toNumberString(taskModel.totalPlanned)}
          </h2>
          <p style={{ marginTop: 6 }}>
            {toNumberString(taskModel.progressPct)}% complete · {toNumberString(taskModel.remainingCount)} remaining
          </p>
          {taskModel.overCompletedCount > 0 ? (
            <p style={{ marginTop: 4 }}>Extra outputs in deliverables: {toNumberString(taskModel.overCompletedCount)}</p>
          ) : null}
        </article>
        <article>
          <p>Done Today</p>
          <h2>{toNumberString(taskModel.doneTodayCount)}</h2>
          <p style={{ marginTop: 6 }}>Content items written today</p>
        </article>
        <article>
          <p>Client Status</p>
          <h2>
            {toNumberString(taskModel.onTrackCount)} / {toNumberString(taskModel.clientRows.length)}
          </h2>
          <p style={{ marginTop: 6 }}>
            On Track {taskModel.onTrackCount} · Watch {taskModel.watchCount} · At Risk {taskModel.atRiskCount}
          </p>
        </article>
        <article>
          <p>Production</p>
          <h2 className="prod-status">
            <span className={`prod-light ${taskModel.productionActive ? 'on' : 'off'}`} />
            {taskModel.productionActive ? 'Live' : 'Idle'}
          </h2>
          <p style={{ marginTop: 6 }}>
            Avg written/hour {formatRate(taskModel.averageWrittenPerHour)} · Total written {toNumberString(taskModel.writtenCount)}
          </p>
          <p style={{ marginTop: 4 }}>Last write: {formatDateTime(taskModel.lastWrittenAt)}</p>
        </article>
        {taskModel.nextOrderUploaded ? (
          <article>
            <p>Next Order Ready</p>
            <h2>{taskModel.nextOrderLabel}</h2>
            <p style={{ marginTop: 6 }}>
              {toNumberString(taskModel.nextTasks.length)} tasks detected · Open when current order is wrapped
            </p>
          </article>
        ) : null}
      </section>

      <section className="dashboard-main-grid">
        <article className="panel-card">
          <header className="panel-card-head">
            <h3>Content Quality</h3>
            <span>
              Units {toNumberString(taskModel.qualitySnapshot.unitCount)} · Avg SEO {taskModel.qualitySnapshot.overallSeo ?? '—'} · Avg Read{' '}
              {taskModel.qualitySnapshot.overallReadability ?? '—'} · Missing images {toNumberString(taskModel.qualitySnapshot.overallMissingImages)}
            </span>
          </header>
          {taskModel.clientQualityRows.length === 0 ? (
            <p className="subhead">No content units found for {selectedOrderLabel} yet.</p>
          ) : (
            <ul className="plain-list dashboard-client-list">
              {taskModel.clientQualityRows.map((row) => {
                let pill: ClientHealthRow['risk'] = 'on_track'
                if ((row.avgSeo !== null && row.avgSeo < 60) || row.missingImages > 0) {
                  pill = 'at_risk'
                } else if (row.avgSeo !== null && row.avgSeo < 75) {
                  pill = 'watch'
                }

                const pct = row.avgSeo ?? 0

                return (
                  <li key={row.slug} className="dashboard-client-row">
                  <div className="dashboard-client-main">
                    <strong>{row.name}</strong>
                    <p>
                      Units {row.unitCount} · Avg SEO {row.avgSeo ?? '—'} · Avg Read {row.avgReadability ?? '—'} · Missing images {row.missingImages}
                    </p>
                    <p>
                      Avg cycle {row.avgCycleHours ?? '—'}h · Avg revisions {row.avgRevisions ?? '—'} · QC pass {row.qcPassPct ?? '—'}%
                    </p>
                    <div className="dashboard-bar-track thin">
                      <div className="dashboard-bar-fill workflow-draft" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                    </div>
                  </div>
                  <div className="dashboard-client-actions">
                    <span className={`risk-pill risk-${pill}`}>{pill === 'at_risk' ? 'Needs Work' : pill === 'watch' ? 'Review' : 'Good'}</span>
                  </div>
                </li>
                )
              })}
            </ul>
          )}
        </article>

        <article className="panel-card">
          <header className="panel-card-head">
            <h3>Stage Deadline Radar</h3>
            <span>Missed / Today / Tomorrow</span>
          </header>
          <ul className="plain-list">
            {taskModel.stageRadarRows.map((row) => (
              <li key={row.stage} className="client-row">
                <div>
                  <strong>{row.label}</strong>
                  <p>
                    Missed {row.missed} · Today {row.today} · Tomorrow {row.tomorrow}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel-card">
          <header className="panel-card-head">
            <h3>Quality Alerts</h3>
            <span>Lowest SEO/readability items in this order</span>
          </header>
          {taskModel.lowQualityUnits.length === 0 ? (
            <p className="subhead">No scored content units found.</p>
          ) : (
            <ul className="plain-list">
              {taskModel.lowQualityUnits.map((unit) => (
                <li key={unit.unitKey} className="client-row">
                  <div>
                    <strong>{unit.draftArtifact?.name ?? unit.unitKey}</strong>
                    <p>
                      {unit.draftArtifact?.clientName ?? unit.clientSlug} · SEO {unit.seoScore ?? '—'} · Read {unit.readabilityScore ?? '—'} · Words{' '}
                      {unit.wordCount ?? '—'} · Images {unit.imageCount ?? '—'} · Revisions {unit.revisionCount} · Cycle {unit.cycleHours ?? '—'}h
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel-card">
          <header className="panel-card-head">
            <h3>Stuck Items</h3>
            <span>Overdue for {STUCK_AFTER_DAYS}+ day(s)</span>
          </header>
          {taskModel.stuckTasks.length === 0 ? (
            <p className="subhead">No stuck items found.</p>
          ) : (
            <ul className="plain-list">
              {taskModel.stuckTasks.map(({ task, due }) => (
                <li key={task.id} className="client-row">
                  <div>
                    <strong>{task.title?.trim() || task.id}</strong>
                    <p>
                      {task.client_slug} · {STAGE_LABEL[task.stage]} · Due {due}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="panel-card">
        <header className="panel-card-head">
          <h3>Recent Artifact Activity</h3>
          <span>Click any row to preview</span>
        </header>
        {recentArtifacts.length === 0 ? (
          <p className="subhead">No artifact files found.</p>
        ) : (
          <ul className="plain-list artifact-list dashboard-artifact-feed">
            {recentArtifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  className={`artifact-row-btn ${selectedArtifact?.id === artifact.id ? 'is-selected' : ''}`}
                  onClick={() => {
                    setLocateMessage('')
                    setSelectedArtifact(artifact)
                  }}
                >
                  <div>
                    <strong>{artifact.name}</strong>
                    <p>
                      {artifact.clientName} · {artifact.weekBucket} · {formatArtifactType(artifact.artifactType)} · {formatWorkflow(artifact.workflow)}
                    </p>
                  </div>
                  <span>{formatDate(artifact.date ?? artifact.modifiedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedArtifact
        ? createPortal(
            <section
              className="item-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Artifact preview"
              onClick={() => {
                setLocateMessage('')
                setSelectedArtifact(null)
              }}
            >
              <article className="item-modal" onClick={(e) => e.stopPropagation()}>
                <header className="item-modal-head">
                  <h3>{selectedArtifact.name}</h3>
                  <button
                    type="button"
                    className="item-modal-close"
                    onClick={() => {
                      setLocateMessage('')
                      setSelectedArtifact(null)
                    }}
                  >
                    Close
                  </button>
                </header>
                <p className="subhead" style={{ marginTop: 0 }}>
                  {selectedArtifact.relativePath}
                </p>
                <p className="subhead">
                  {selectedArtifact.level} · {formatWorkflow(selectedArtifact.workflow)} · {formatArtifactType(selectedArtifact.artifactType)}
                </p>
                {selectedArtifact.analysis ? (
                  <p className="subhead">
                    SEO {selectedArtifact.analysis.seoScore ?? '—'} · Read {selectedArtifact.analysis.readabilityScore ?? '—'} · Words{' '}
                    {publishableWordCount ?? selectedArtifact.analysis.wordCount ?? '—'} · Images {preview.images?.length ?? selectedArtifact.analysis.imageCount ?? '—'}
                  </p>
                ) : null}
                {preview.images && preview.images.length > 0 ? (
                  <section style={{ marginTop: 12 }}>
                    <h4 style={{ margin: '8px 0' }}>Images</h4>
                    <ul className="plain-list">
                      {preview.images.map((img, idx) => (
                        <li key={`${img.url ?? img.filename ?? idx}`}>
                          {img.url ? (
                            <a href={img.url} target="_blank" rel="noreferrer">
                              {img.filename ?? `image-${idx + 1}`}
                            </a>
                          ) : (
                            <span>{img.filename ?? `image-${idx + 1}`}</span>
                          )}
                          {img.category ? <span className="subhead"> · {img.category}</span> : null}
                          {img.alt ? <div className="subhead">Alt: {img.alt}</div> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <div className="preview-actions">
                  <a className="action-btn" href={artifactDownloadUrl(previewKey ?? selectedArtifact.relativePath)}>
                    Download
                  </a>
                  {!import.meta.env.PROD ? (
                    <>
                      <button
                        type="button"
                        className="action-btn"
                        disabled={locating}
                        onClick={async () => {
                          try {
                            setLocating(true)
                            setLocateMessage('')
                            await locateArtifact(selectedArtifact.relativePath)
                            setLocateMessage('Opened file location.')
                          } catch (error) {
                            setLocateMessage(error instanceof Error ? error.message : 'Failed to locate file')
                          } finally {
                            setLocating(false)
                          }
                        }}
                      >
                        {locating ? 'Locating…' : 'Locate File'}
                      </button>
                      {locateMessage ? <span className="subhead">{locateMessage}</span> : null}
                    </>
                  ) : null}
                </div>
                {preview.status === 'loading' ? <p className="subhead">Loading artifact…</p> : null}
                {preview.status === 'error' ? <pre className="artifact-preview">{preview.content}</pre> : null}
                {preview.status === 'ready' ? <pre className="artifact-preview">{preview.content}</pre> : null}
              </article>
            </section>,
            document.body,
          )
        : null}
    </div>
  )
}
