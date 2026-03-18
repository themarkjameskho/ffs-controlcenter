import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { Stage, Task } from '../lib/types'
import { useClients, useWeekBoard } from '../lib/state'
import { dataSource } from '../lib/dataSource'

type LaneId = 'inbox' | 'work-in-progress' | 'approval' | 'done'

const LANE_ACCENT: Record<LaneId, string> = {
  inbox: '#9ca3af',
  'work-in-progress': '#22c55e',
  approval: '#f97316',
  done: '#8b5cf6'
}

const LANE_LABEL: Record<LaneId, string> = {
  inbox: 'Inbox',
  'work-in-progress': 'Work In Progress',
  approval: 'Approval',
  done: 'Done'
}

const STAGE_SORT: Stage[] = ['human-order', 'planner', 'researcher', 'writer', 'qc', 'publisher']

const TYPE_LABEL: Record<string, string> = {
  human_order: 'Human Order',
  plan_artifact: 'Plan Artifact',
  research_pack: 'Research Pack',
  draft: 'Draft',
  qc_report: 'QC Report',
  publish_bundle: 'Publish Bundle'
}

type OrderRegistryEntry = {
  id: string
  label: string
  year: number
  startWeek: number
  endWeek: number
}

type OrderRegistryPayload = {
  ok?: boolean
  orders?: OrderRegistryEntry[]
  sourceCsv?: string
}

type OrderWindow = {
  year: number
  startWeek: number
  endWeek: number
  label: string
}

const ALL_ORDERS_KEY = '__all_orders__'
const POLL_INTERVAL_MS = 5000

function orderKey(window: OrderWindow) {
  return `${window.year}:${window.startWeek}-${window.endWeek}`
}

function weekRange(window: OrderWindow) {
  const out: number[] = []
  for (let week = window.startWeek; week <= window.endWeek; week += 1) out.push(week)
  return out
}

function formatDeliverableKind(kind: string) {
  return kind
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function ownerLabel(task: Task) {
  const raw = String(task.owner ?? '').trim()
  if (!raw) return 'Unassigned'
  return raw
}

function laneForStage(stage: Stage): LaneId {
  if (stage === 'human-order' || stage === 'planner') return 'inbox'
  if (stage === 'researcher' || stage === 'writer') return 'work-in-progress'
  if (stage === 'qc') return 'approval'
  return 'done'
}

function stageForLane(task: Task, lane: LaneId): Stage {
  if (lane === 'inbox') {
    return task.type === 'human_order' ? 'human-order' : 'planner'
  }
  if (lane === 'work-in-progress') {
    if (task.stage === 'researcher' || task.stage === 'writer') return task.stage
    if (task.type === 'research_pack') return 'researcher'
    return 'writer'
  }
  if (lane === 'approval') return 'qc'
  return 'publisher'
}

function phraseClientName(clientSlug: string, clientNameBySlug: Record<string, string>) {
  const raw = (clientNameBySlug[clientSlug] ?? clientSlug).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!raw) return 'Unknown Client'
  return raw
    .split(' ')
    .map((word) => {
      if (!word) return word
      return word[0].toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

function cardTitle(task: Task, fallbackWeek: number, clientNameBySlug: Record<string, string>) {
  const clientLabel = phraseClientName(task.client_slug, clientNameBySlug)
  if (task.stage === 'human-order') {
    return `Week ${task.week ?? fallbackWeek} — ${clientLabel}`
  }
  if (task.title && task.title.trim()) return task.title
  return `${TYPE_LABEL[task.type ?? ''] ?? 'Item'} — ${clientLabel}`
}

function cardDescription(task: Task) {
  if (task.description && task.description.trim()) return task.description.trim()

  switch (task.type) {
    case 'human_order':
      return 'Human Order item (Week + Client). Planner will expand this into scheduled work.'
    case 'plan_artifact':
      return 'Planner output (schedule + work packages) derived from the Human Order.'
    case 'research_pack':
      return 'Research Pack to be accepted/executed by Researcher.'
    case 'draft':
      return 'Writer draft derived from an accepted Research Pack.'
    case 'qc_report':
      return task.qc_spotcheck ? 'Daily QC spot-check for the first draft of the day.' : 'Weekly batch QC item.'
    case 'publish_bundle':
      return 'Publishing bundle / final package for handoff to human publishing.'
    default:
      return 'Workflow item.'
  }
}

function stageDate(task: Task) {
  if (task.stage === 'researcher') return task.research_date
  if (task.stage === 'writer') return task.writer_date
  if (task.stage === 'qc') return task.qc_date
  if (task.stage === 'publisher') return task.publish_date
  if (task.stage === 'planner') return task.research_date
  return null
}

function deadlineFor(task: Task) {
  return stageDate(task) ?? task.publish_date ?? task.qc_date ?? task.writer_date ?? task.research_date ?? task.eta ?? '—'
}

function dateText(task: Task) {
  const parts = [
    task.research_date ? `Research: ${task.research_date}` : null,
    task.writer_date ? `Writer: ${task.writer_date}` : null,
    task.qc_date ? `QC: ${task.qc_date}` : null,
    task.publish_date ? `Publish: ${task.publish_date}` : null
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : '—'
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

export default function Kanban() {
  const [orderRegistry, setOrderRegistry] = useState<{
    loading: boolean
    error: string
    orders: OrderWindow[]
    sourceCsv: string
  }>({
    loading: true,
    error: '',
    orders: [],
    sourceCsv: ''
  })
  const [selectedOrderView, setSelectedOrderView] = useState<string>(ALL_ORDERS_KEY)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const payload = await fetchOrderRegistry()
        if (cancelled) return
        if (!payload || payload.ok === false) {
          throw new Error('Failed to load order registry')
        }
        const orders = (payload.orders ?? [])
          .map((entry) => ({
            year: entry.year,
            startWeek: entry.startWeek,
            endWeek: entry.endWeek,
            label: entry.label
          }))
          .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.startWeek - b.startWeek))
        setOrderRegistry({
          loading: false,
          error: '',
          orders,
          sourceCsv: payload.sourceCsv ?? ''
        })
      } catch (error) {
        if (cancelled) return
        setOrderRegistry((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load order registry'
        }))
      }
    }

    void run()
    const timer = window.setInterval(() => {
      void run()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    setSelectedOrderView((prev) => {
      if (prev === ALL_ORDERS_KEY) return prev
      if (orderRegistry.orders.some((order) => orderKey(order) === prev)) return prev
      return orderRegistry.orders[0] ? orderKey(orderRegistry.orders[0]) : ALL_ORDERS_KEY
    })
  }, [orderRegistry.orders])

  const selectedWeeks = useMemo(() => {
    if (selectedOrderView === ALL_ORDERS_KEY) {
      const weeks = new Set<number>()
      for (const order of orderRegistry.orders) {
        for (const week of weekRange(order)) weeks.add(week)
      }
      return Array.from(weeks).sort((a, b) => a - b)
    }
    const selected = orderRegistry.orders.find((order) => orderKey(order) === selectedOrderView)
    return selected ? weekRange(selected) : [11]
  }, [orderRegistry.orders, selectedOrderView])

  const { year, week, tasks, lastSync, moveTask, changePulseById } = useWeekBoard(11, {
    weeks: selectedWeeks
  })
  const selectedOrderLabel = useMemo(() => {
    if (selectedOrderView === ALL_ORDERS_KEY) return 'All Orders'
    const selected = orderRegistry.orders.find((order) => orderKey(order) === selectedOrderView)
    return selected?.label ?? 'Order'
  }, [orderRegistry.orders, selectedOrderView])
  const sourceCsvName = orderRegistry.sourceCsv.split('/').pop() || orderRegistry.sourceCsv
  const selectedWeeksLabel = selectedWeeks.length > 0 ? selectedWeeks.join(', ') : String(week)
  const clientNameBySlug = useClients()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Kanban shows only work that is active/working/done (hide locked future work).
  const kanbanTasks = tasks.filter((t) => t.status !== 'locked')
  const laneOrder: LaneId[] = ['inbox', 'work-in-progress', 'approval', 'done']
  const columns = laneOrder.map((lane) => ({
    id: lane,
    title: LANE_LABEL[lane],
    tasks: kanbanTasks
      .filter((task) => laneForStage(task.stage) === lane)
      .sort((a, b) => {
        const stageDiff = STAGE_SORT.indexOf(a.stage) - STAGE_SORT.indexOf(b.stage)
        if (stageDiff !== 0) return stageDiff
        if ((a.week ?? 0) !== (b.week ?? 0)) return (a.week ?? 0) - (b.week ?? 0)
        if (a.client_slug !== b.client_slug) return a.client_slug.localeCompare(b.client_slug)
        return a.id.localeCompare(b.id)
      })
  }))
  const totals = {
    total: kanbanTasks.length,
    byStage: {
      'human-order': kanbanTasks.filter((t) => t.stage === 'human-order').length,
      planner: kanbanTasks.filter((t) => t.stage === 'planner').length,
      researcher: kanbanTasks.filter((t) => t.stage === 'researcher').length,
      writer: kanbanTasks.filter((t) => t.stage === 'writer').length,
      qc: kanbanTasks.filter((t) => t.stage === 'qc').length,
      publisher: kanbanTasks.filter((t) => t.stage === 'publisher').length
    }
  }
  const taskById = useMemo(() => new Map(kanbanTasks.map((task) => [task.id, task])), [kanbanTasks])
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverLane, setDragOverLane] = useState<LaneId | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null
  const [artifactContent, setArtifactContent] = useState<string>('')
  const [artifactStatus, setArtifactStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!selectedTask?.artifact_path) {
        setArtifactContent('')
        setArtifactStatus('idle')
        return
      }
      setArtifactStatus('loading')
      try {
        const res = await fetch(`/api/artifact?path=${encodeURIComponent(selectedTask.artifact_path)}`, { cache: 'no-store' })
        const data = (await res.json()) as { ok?: boolean; content?: string; error?: string }
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setArtifactStatus('error')
          setArtifactContent(data.error || 'Failed to load artifact')
          return
        }
        setArtifactStatus('ready')
        setArtifactContent(data.content || '')
      } catch {
        if (cancelled) return
        setArtifactStatus('error')
        setArtifactContent('Failed to load artifact')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [selectedTask?.artifact_path])

  const relatedDeliverables = selectedTask
    ? tasks
        .filter((t) => t.client_slug === selectedTask.client_slug && (t.week ?? week) === (selectedTask.week ?? week))
        .sort((a, b) => {
          const aStage = STAGE_SORT.indexOf(a.stage)
          const bStage = STAGE_SORT.indexOf(b.stage)
          if (aStage !== bStage) return aStage - bStage
          return a.id.localeCompare(b.id)
        })
    : []

  const plannerItemForSelection = selectedTask
    ? relatedDeliverables.find((t) => t.type === 'plan_artifact') ?? null
    : null

  const weekDeliverables = plannerItemForSelection?.deliverables
    ? Object.entries(plannerItemForSelection.deliverables)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => ({ kind: k, qty: v }))
    : []

  const handleCardDragStart = (event: DragEvent<HTMLLIElement>, taskId: string) => {
    setDragTaskId(taskId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
  }

  const handleColumnDragOver = (event: DragEvent<HTMLElement>, lane: LaneId) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverLane !== lane) {
      setDragOverLane(lane)
    }
  }

  const handleColumnDrop = (event: DragEvent<HTMLElement>, lane: LaneId) => {
    event.preventDefault()
    if (!dragTaskId) return
    const task = taskById.get(dragTaskId)
    if (!task) return
    moveTask(dragTaskId, stageForLane(task, lane))
    setDragTaskId(null)
    setDragOverLane(null)
  }

  const handleUpload = async () => {
    if (queuedFiles.length === 0 || importing) return
    setImporting(true)
    setImportStatus('')

    try {
      const files = await Promise.all(
        queuedFiles.map(async (file) => ({
          name: file.name,
          content: await file.text()
        }))
      )

      const res = await fetch('/api/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'CSV import failed')
      }

      const payload = (await res.json()) as { filesWritten?: number; inbox?: string }
      setImportStatus(`Uploaded ${payload.filesWritten ?? queuedFiles.length} file(s) to ${payload.inbox ?? 'inbox'}`)
      setQueuedFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CSV import failed'
      setImportStatus(`Import failed: ${message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">CSV Importer</p>
          <h1>CSV Importer 1</h1>
          <p className="subhead">
            Source: .openclaw/workspace/human_orders/_inbox/ · Order: {selectedOrderLabel} · Weeks: {selectedWeeksLabel} · Last sync:{' '}
            {lastSync || '—'}
          </p>
          <div className="importer-controls">
            <input
              ref={fileInputRef}
              className="importer-file-input"
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={(e) => setQueuedFiles(Array.from(e.target.files ?? []))}
            />
            <button type="button" className="importer-btn" onClick={() => fileInputRef.current?.click()}>
              Choose CSV file(s)
            </button>
            <button type="button" className="importer-btn primary" onClick={handleUpload} disabled={queuedFiles.length === 0 || importing}>
              {importing ? 'Importing…' : 'Import Selected'}
            </button>
            <span className="importer-hint">
              {queuedFiles.length > 0 ? `${queuedFiles.length} file(s) ready` : 'No files selected'}
            </span>
          </div>
          {importStatus ? <p className="subhead importer-status">{importStatus}</p> : null}
        </div>

        <div className="masthead-meta">
          <span className="meta-pill hot">Live</span>
          <span className="meta-pill">Year {year}</span>
          <label className="meta-pill dashboard-order-select">
            Order
            <select value={selectedOrderView} onChange={(event) => setSelectedOrderView(event.target.value)}>
              <option value={ALL_ORDERS_KEY}>All Orders</option>
              {orderRegistry.orders.map((order) => (
                <option key={orderKey(order)} value={orderKey(order)}>
                  {order.label}
                </option>
              ))}
            </select>
          </label>
          {sourceCsvName ? <span className="meta-pill">Plan CSV {sourceCsvName}</span> : null}
        </div>
      </header>

      {orderRegistry.loading ? <p className="subhead">Refreshing order registry…</p> : null}
      {orderRegistry.error ? <p className="subhead">{orderRegistry.error}</p> : null}

      <section className="summary-row">
        <article>
          <p>Total Items</p>
          <h2>{totals.total}</h2>
        </article>
        <article>
          <p>In Progress (Researcher+Writer+QC)</p>
          <h2>{totals.byStage.researcher + totals.byStage.writer + totals.byStage.qc}</h2>
        </article>
        <article>
          <p>Ready / Published</p>
          <h2>{totals.byStage.publisher}</h2>
        </article>
      </section>

      <p className="dnd-hint">Drag and drop cards between columns. Changes apply instantly.</p>

      <main className="kanban-grid" aria-label="Kanban board">
        {columns.map((column) => (
          <section
            key={column.id}
            className={`kanban-column ${dragOverLane === column.id ? 'is-drop-target' : ''}`}
            onDragOver={(e) => handleColumnDragOver(e, column.id)}
            onDragEnter={() => setDragOverLane(column.id)}
            onDragLeave={() => setDragOverLane((prev) => (prev === column.id ? null : prev))}
            onDrop={(e) => handleColumnDrop(e, column.id)}
          >
            <header>
              <div>
                <span className="column-pill" style={{ background: LANE_ACCENT[column.id] }} />
                <h3>{column.title}</h3>
              </div>
              <p>{column.tasks.length} items</p>
            </header>

            <ul>
              {column.tasks.map((task) => {
                return (
                  <li
                    key={task.id}
                    className={`kanban-card ${dragTaskId === task.id ? 'is-dragging' : ''} ${
                      changePulseById[task.id] ? `pulse-${changePulseById[task.id]}` : ''
                    }`}
                    draggable
                    onClick={() => {
                      if (!dragTaskId) setSelectedTaskId(task.id)
                    }}
                    onDragStart={(e) => handleCardDragStart(e, task.id)}
                    onDragEnd={() => {
                      setDragTaskId(null)
                      setDragOverLane(null)
                    }}
                  >
                    <p className="task-title">{cardTitle(task, week, clientNameBySlug)}</p>
                    <p className="task-client-pill">{phraseClientName(task.client_slug, clientNameBySlug)}</p>
                    <p className="task-assigned">Assigned: {ownerLabel(task)}</p>
                    <p className="task-description">{cardDescription(task)}</p>
                    <p className="task-eta">ETA: {deadlineFor(task)}</p>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </main>

      {selectedTask && (
        <section className="item-modal-backdrop" role="dialog" aria-modal="true" aria-label="Item details">
          <article className="item-modal">
            <header className="item-modal-head">
              <h3>{cardTitle(selectedTask, week, clientNameBySlug)}</h3>
              <button type="button" className="item-modal-close" onClick={() => setSelectedTaskId(null)}>
                Close
              </button>
            </header>

            <div className="item-modal-meta">
              <p>
                <strong>Week Number:</strong> {selectedTask.week ?? week}
              </p>
              <p>
                <strong>Client:</strong> {phraseClientName(selectedTask.client_slug, clientNameBySlug)}
              </p>
              <p>
                <strong>Owner:</strong> {ownerLabel(selectedTask)}
              </p>
            </div>

            <h4>What this item is</h4>
            <p style={{ marginTop: 0, opacity: 0.9 }}>{cardDescription(selectedTask)}</p>

            {selectedTask.type === 'human_order' && (
              <>
                <h4>Week deliverables (from Planner)</h4>
                {weekDeliverables.length === 0 ? (
                  <p style={{ marginTop: 0, opacity: 0.75 }}>—</p>
                ) : (
                  <ul className="item-modal-list">
                    {weekDeliverables.map((d) => (
                      <li key={d.kind}>
                        <p>
                          <strong>{formatDeliverableKind(d.kind)}</strong>
                        </p>
                        <p>Quantity: {d.qty}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {(selectedTask.type === 'research_pack' || selectedTask.type === 'draft') && (
              <>
                <h4>Artifact preview</h4>
                {!selectedTask.artifact_path ? (
                  <p style={{ marginTop: 0, opacity: 0.75 }}>No artifact linked yet.</p>
                ) : artifactStatus === 'loading' ? (
                  <p style={{ marginTop: 0, opacity: 0.75 }}>Loading…</p>
                ) : artifactStatus === 'error' ? (
                  <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.85 }}>{artifactContent}</pre>
                ) : (
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12,
                      padding: 12,
                      maxHeight: 320,
                      overflow: 'auto'
                    }}
                  >
                    {artifactContent}
                  </pre>
                )}
              </>
            )}

            <h4>Connected tasks (same client/week)</h4>
            <ul className="item-modal-list">
              {relatedDeliverables.map((task) => (
                <li key={task.id}>
                  <p>
                    <strong>{TYPE_LABEL[task.type ?? ''] ?? task.type ?? 'Item'}</strong> ({task.stage})
                  </p>
                  <p>
                    Owner {ownerLabel(task)} · {dateText(task)}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        </section>
      )}
    </div>
  )
}
