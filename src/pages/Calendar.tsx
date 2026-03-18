import { Fragment, useMemo, useState } from 'react'
import type { Stage, Task } from '../lib/types'
import { ymd } from '../lib/date'
import { STAGE_LABEL, useClients, useWeekBoard } from '../lib/state'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STAGE_ORDER: Stage[] = ['human-order', 'planner', 'researcher', 'writer', 'qc', 'publisher']

const TYPE_LABEL: Record<string, string> = {
  human_order: 'Human Order',
  plan_artifact: 'Plan Artifact',
  research_pack: 'Research Pack',
  draft: 'Draft',
  qc_report: 'QC Report',
  publish_bundle: 'Publish Bundle'
}

type DayGroup = {
  stage: Stage
  type: string
  count: number
  pulse?: 'created' | 'moved'
}

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })
}

function addDaysUTC(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(date.getUTCDate() + days)
  return next
}

function getCalendarStart(year: number, month: number) {
  const monthStart = new Date(Date.UTC(year, month, 1))
  const day = monthStart.getUTCDay() || 7
  return addDaysUTC(monthStart, -(day - 1))
}

function isoWeekNumber(date: Date) {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function calendarDate(task: Task) {
  if (task.stage === 'researcher') return task.research_date
  if (task.stage === 'writer') return task.writer_date
  if (task.stage === 'qc') return task.qc_date
  if (task.stage === 'publisher') return task.publish_date
  if (task.stage === 'planner') return task.research_date
  return null
}

function cardTitle(task: Task, clientNameBySlug: Record<string, string>) {
  const clientLabel = clientNameBySlug[task.client_slug] ?? task.client_slug
  if (task.stage === 'human-order') return `Week ${task.week ?? '—'} — ${clientLabel}`
  if (task.title && task.title.trim()) return task.title
  return `${TYPE_LABEL[task.type ?? ''] ?? 'Item'} — ${task.client_slug}`
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

function dateText(task: Task) {
  const parts = [
    task.research_date ? `Research: ${task.research_date}` : null,
    task.writer_date ? `Writer: ${task.writer_date}` : null,
    task.qc_date ? `QC: ${task.qc_date}` : null,
    task.publish_date ? `Publish: ${task.publish_date}` : null
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : '—'
}

function parseYmd(value: string | null | undefined) {
  if (!value) return null
  const [yy, mm, dd] = value.split('-').map(Number)
  if (!yy || !mm || !dd) return null
  return new Date(Date.UTC(yy, mm - 1, dd))
}

export default function Calendar() {
  const { tasks, lastSync, changePulseById } = useWeekBoard(11)
  const clientNameBySlug = useClients()
  const now = new Date()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const firstScheduled = useMemo(() => {
    const dates = tasks.map((t) => parseYmd(calendarDate(t))).filter(Boolean) as Date[]
    if (!dates.length) return null
    return dates.sort((a, b) => a.getTime() - b.getTime())[0]
  }, [tasks])

  const [monthCursor, setMonthCursor] = useState(() => {
    const seed = firstScheduled ?? now
    return { year: seed.getUTCFullYear(), month: seed.getUTCMonth() }
  })

  const weeks = useMemo(() => {
    const start = getCalendarStart(monthCursor.year, monthCursor.month)
    const cells = Array.from({ length: 42 }, (_, i) => addDaysUTC(start, i))
    return Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  }, [monthCursor.month, monthCursor.year])

  const tasksByDay = useMemo(() => {
    const byDay = new Map<string, Task[]>()
    for (const task of tasks) {
      const day = calendarDate(task)
      if (!day) continue

      const bucket = byDay.get(day) ?? []
      bucket.push(task)
      byDay.set(day, bucket)
    }

    byDay.forEach((bucket) => {
      bucket.sort((a, b) => {
        const stageA = STAGE_ORDER.indexOf(a.stage)
        const stageB = STAGE_ORDER.indexOf(b.stage)
        if (stageA !== stageB) return stageA - stageB
        return a.id.localeCompare(b.id)
      })
    })

    return byDay
  }, [tasks])

  const groupedByDay = useMemo(() => {
    const byDay = new Map<string, Map<string, DayGroup>>()
    for (const task of tasks) {
      const day = calendarDate(task)
      if (!day) continue
      const groupKey = `${task.stage}|${task.type ?? 'item'}`
      const map = byDay.get(day) ?? new Map<string, DayGroup>()
      const prev = map.get(groupKey) ?? { stage: task.stage, type: task.type ?? 'item', count: 0, pulse: undefined }
      const pulse = changePulseById[task.id]
      prev.count += 1
      if (pulse === 'moved' || prev.pulse === 'moved') {
        prev.pulse = 'moved'
      } else if (pulse === 'created' && !prev.pulse) {
        prev.pulse = 'created'
      }
      map.set(groupKey, prev)
      byDay.set(day, map)
    }
    return byDay
  }, [changePulseById, tasks])

  const dayPulseByYmd = useMemo(() => {
    const map = new Map<string, 'created' | 'moved'>()
    for (const task of tasks) {
      const pulse = changePulseById[task.id]
      if (!pulse) continue
      const day = calendarDate(task)
      if (!day) continue
      const prev = map.get(day)
      if (prev === 'moved' || pulse === 'moved') {
        map.set(day, 'moved')
      } else {
        map.set(day, 'created')
      }
    }
    return map
  }, [changePulseById, tasks])

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(monthCursor.year, monthCursor.month + delta, 1))
    setMonthCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() })
  }

  const todayYmd = ymd(now)
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null
  const relatedDeliverables = selectedTask
    ? tasks
        .filter((t) => t.client_slug === selectedTask.client_slug && (selectedTask.week ? (t.week ?? selectedTask.week) === selectedTask.week : true))
        .sort((a, b) => {
          const stageA = STAGE_ORDER.indexOf(a.stage)
          const stageB = STAGE_ORDER.indexOf(b.stage)
          if (stageA !== stageB) return stageA - stageB
          return a.id.localeCompare(b.id)
        })
    : []

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Fast Forward Search</p>
          <h1>Control Center · Calendar</h1>
          <p className="subhead">
            {monthLabel(monthCursor.year, monthCursor.month)} · Last sync: {lastSync || '—'}
          </p>
        </div>

        <div className="masthead-meta">
          <button type="button" className="meta-pill calendar-nav-btn" onClick={() => shiftMonth(-1)}>
            Prev
          </button>
          <button
            type="button"
            className="meta-pill calendar-nav-btn"
            onClick={() => setMonthCursor({ year: now.getUTCFullYear(), month: now.getUTCMonth() })}
          >
            Today
          </button>
          <button type="button" className="meta-pill calendar-nav-btn" onClick={() => shiftMonth(1)}>
            Next
          </button>
        </div>
      </header>

      <section className="calendar-month-board" aria-label="Monthly calendar">
        <div className="calendar-month-grid">
          <div className="calendar-week-header">Wk</div>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="calendar-day-header">
              {label}
            </div>
          ))}

          {weeks.map((weekDays) => {
            const weekId = `W${isoWeekNumber(weekDays[0])}`
            return (
              <Fragment key={ymd(weekDays[0])}>
                <div className="calendar-week-label">{weekId}</div>

                {weekDays.map((day) => {
                  const key = ymd(day)
                  const groups = Array.from(groupedByDay.get(key)?.values() ?? [])
                  const dayTasks = tasksByDay.get(key) ?? []
                  const dayPulse = dayPulseByYmd.get(key)
                  const isCurrentMonth = day.getUTCMonth() === monthCursor.month
                  const isToday = key === todayYmd

                  return (
                    <article
                      key={key}
                      className={`calendar-day-cell ${isCurrentMonth ? '' : 'outside-month'} ${isToday ? 'is-today' : ''} ${
                        dayPulse ? `pulse-${dayPulse}` : ''
                      }`}
                    >
                      <header className="calendar-day-cell-head">
                        <span>{day.getUTCDate()}</span>
                      </header>

                      {groups.length === 0 ? (
                        <p className="calendar-week-empty">—</p>
                      ) : (
                        <ul className="calendar-week-chips" aria-hidden="true">
                          {groups.map((group) => (
                            <li
                              key={`${group.stage}-${group.type}`}
                              className={`calendar-week-chip ${group.pulse ? `pulse-${group.pulse}` : ''}`}
                            >
                              <span>{STAGE_LABEL[group.stage]}</span>
                              <span>{group.type}</span>
                              <strong>{group.count}</strong>
                            </li>
                          ))}
                        </ul>
                      )}

                      {dayTasks.length > 0 && (
                        <ul className="calendar-day-item-list">
                          {dayTasks.map((task) => (
                            <li key={task.id}>
                              <button
                                type="button"
                                className={`calendar-day-item-btn ${changePulseById[task.id] ? `pulse-${changePulseById[task.id]}` : ''}`}
                                onClick={() => setSelectedTaskId(task.id)}
                              >
                                {cardTitle(task, clientNameBySlug)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      </section>

      {selectedTask && (
        <section className="item-modal-backdrop" role="dialog" aria-modal="true" aria-label="Calendar item details" onClick={() => setSelectedTaskId(null)}>
          <article className="item-modal" onClick={(e) => e.stopPropagation()}>
            <header className="item-modal-head">
              <h3>{cardTitle(selectedTask, clientNameBySlug)}</h3>
              <button type="button" className="item-modal-close" onClick={() => setSelectedTaskId(null)}>
                Close
              </button>
            </header>

            <div className="item-modal-meta">
              <p>
                <strong>Week Number:</strong> {selectedTask.week ?? '—'}
              </p>
              <p>
                <strong>Client:</strong> {selectedTask.client_slug}
              </p>
            </div>

            <h4>What this item is</h4>
            <p style={{ marginTop: 0, opacity: 0.9 }}>{cardDescription(selectedTask)}</p>

            <h4>Connected tasks (same client/week)</h4>
            <ul className="item-modal-list">
              {relatedDeliverables.map((task) => (
                <li key={task.id}>
                  <p>
                    <strong>{TYPE_LABEL[task.type ?? ''] ?? task.type ?? 'Item'}</strong> ({STAGE_LABEL[task.stage]})
                  </p>
                  <p>{dateText(task)}</p>
                </li>
              ))}
            </ul>
          </article>
        </section>
      )}
    </div>
  )
}
