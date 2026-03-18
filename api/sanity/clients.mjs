import { sanityClient } from './_client.mjs'
import { json, methodNotAllowed } from './_http.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)

  try {
    const client = sanityClient({ mode: 'read' })
    const clients = await client.fetch(
      `*[_type == "client"] | order(name asc) {slug, name}`
    )
    json(res, 200, { ok: true, clients: Array.isArray(clients) ? clients : [] })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load clients' })
  }
}

