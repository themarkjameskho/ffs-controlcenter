import { sanityClient } from './_client.mjs'
import { json, methodNotAllowed } from './_http.mjs'

function coerceNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)

  try {
    const client = sanityClient({ mode: 'read' })
    const snapshot = await client.fetch(`*[_id == "ffstate-orders"][0]{sourceCsv, generatedAt, orders}`)
    if (snapshot && Array.isArray(snapshot.orders)) {
      const normalizedSnapshot = snapshot.orders.map((o) => ({
        id: String(o.id ?? ''),
        label: String(o.label ?? ''),
        year: coerceNumber(o.year),
        startWeek: coerceNumber(o.startWeek),
        endWeek: coerceNumber(o.endWeek),
        plannedTotal: coerceNumber(o.plannedTotal),
        plannedByClient: (o.plannedByClient && typeof o.plannedByClient === 'object' ? o.plannedByClient : {}) ?? {},
        plannedByType: (o.plannedByType && typeof o.plannedByType === 'object' ? o.plannedByType : {}) ?? {}
      }))

      return json(res, 200, {
        ok: true,
        sourceCsv: String(snapshot.sourceCsv ?? ''),
        generatedAt: String(snapshot.generatedAt ?? new Date().toISOString()),
        orders: normalizedSnapshot
      })
    }

    const orders = await client.fetch(
      `*[_type == "orderWindow"] | order(year asc, startWeek asc) {
        _id,
        id,
        label,
        year,
        startWeek,
        endWeek,
        plannedTotal,
        plannedByClient,
        plannedByType,
        source,
        generatedAt
      }`
    )

    const normalized = (Array.isArray(orders) ? orders : []).map((o) => ({
      id: String(o.id ?? o._id ?? ''),
      label: String(o.label ?? ''),
      year: coerceNumber(o.year),
      startWeek: coerceNumber(o.startWeek),
      endWeek: coerceNumber(o.endWeek),
      plannedTotal: coerceNumber(o.plannedTotal),
      plannedByClient: (o.plannedByClient && typeof o.plannedByClient === 'object' ? o.plannedByClient : {}) ?? {},
      plannedByType: (o.plannedByType && typeof o.plannedByType === 'object' ? o.plannedByType : {}) ?? {}
    }))

    const sourceCsv = Array.isArray(orders) && orders[0]?.source ? String(orders[0].source) : ''
    const generatedAt = Array.isArray(orders) && orders[0]?.generatedAt ? String(orders[0].generatedAt) : new Date().toISOString()

    json(res, 200, { ok: true, sourceCsv, generatedAt, orders: normalized })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load order registry' })
  }
}
