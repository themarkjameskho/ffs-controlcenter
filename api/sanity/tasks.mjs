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

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)
  const url = new URL(req.url, 'http://localhost')
  const week = url.searchParams.get('week')
  const weeks = url.searchParams.get('weeks')
  const requestedWeeks = weeks ? parseWeeks(weeks) : week ? parseWeeks(week) : []

  if (requestedWeeks.length === 0) return badRequest(res, 'Missing week/weeks')

  try {
    const client = sanityClient({ mode: 'read' })
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
