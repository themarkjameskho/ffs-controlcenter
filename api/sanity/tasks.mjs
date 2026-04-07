import { sanityClient } from './_client.mjs'
import { badRequest, json, methodNotAllowed } from './_http.mjs'

function parseWeeks(value) {
  const raw = String(value || '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(1, Math.min(53, Math.trunc(n))))
}

function applyLivePatches(tasks, live) {
  if (!live?.tasks?.length) return tasks
  const patchById = new Map(live.tasks.map((patch) => [patch.id, patch]))
  return tasks.map((task) => {
    const patch = patchById.get(task.id)
    if (!patch) return task
    return {
      ...task,
      stage: patch.stage ?? task.stage,
      owner: patch.owner ?? task.owner,
      eta: patch.eta ?? task.eta,
      parent_id: patch.parent_id ?? task.parent_id,
      research_date: patch.research_date ?? task.research_date,
      writer_date: patch.writer_date ?? task.writer_date,
      qc_date: patch.qc_date ?? task.qc_date,
      publish_date: patch.publish_date ?? task.publish_date,
      status: patch.status ?? task.status
    }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)
  const url = new URL(req.url, 'http://localhost')
  const week = url.searchParams.get('week')
  const weeks = url.searchParams.get('weeks')
  const requestedWeeks = weeks ? parseWeeks(weeks) : week ? parseWeeks(week) : []

  if (requestedWeeks.length === 0) return badRequest(res, 'Missing week/weeks')

  try {
    const client = sanityClient({ mode: 'read' })
    const [weekSnapshots, liveSnapshot] = await Promise.all([
      client.fetch(
        `*[_type == "ffStateWeek" && week in $weeks] | order(week asc) {
          week,
          year,
          updatedAt,
          tasks
        }`,
        { weeks: requestedWeeks }
      ),
      client.fetch(`*[_id == "ffstate-live"][0]{updatedAt, tasks}`)
    ])

    if (Array.isArray(weekSnapshots) && weekSnapshots.length > 0) {
      const baseTasks = []
      for (const snapshot of weekSnapshots) {
        const week = Number(snapshot?.week ?? 0)
        const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : []
        for (const task of tasks) {
          if (!task || typeof task !== 'object') continue
          baseTasks.push({ ...task, week: task.week ?? week })
        }
      }
      const mergedTasks = applyLivePatches(baseTasks, liveSnapshot ?? null)
      return json(res, 200, {
        ok: true,
        generatedAt: String(liveSnapshot?.updatedAt ?? new Date().toISOString()),
        weeks: requestedWeeks,
        tasks: mergedTasks
      })
    }

    const tasks = await client.fetch(
      `*[_type == "task" && week in $weeks] | order(week asc, client_slug asc, _id asc) {
        id,
        type,
        client_slug,
        content_type,
        title,
        description,
        stage,
        week,
        parent_id,
        status,
        priority,
        owner,
        eta,
        research_date,
        writer_date,
        qc_date,
        publish_date,
        qc_spotcheck,
        deliverables,
        artifact_path
      }`,
      { weeks: requestedWeeks }
    )
    json(res, 200, { ok: true, generatedAt: new Date().toISOString(), weeks: requestedWeeks, tasks: Array.isArray(tasks) ? tasks : [] })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load tasks' })
  }
}
