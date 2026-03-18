import { sanityClient } from './_client.mjs'
import { badRequest, json, methodNotAllowed } from './_http.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)

  const url = new URL(req.url, 'http://localhost')
  const id = String(url.searchParams.get('id') || '').trim()
  if (!id) return badRequest(res, 'Missing id')

  try {
    const client = sanityClient({ mode: 'read' })
    const doc = await client.fetch(
      `*[_type == "artifact" && (id == $id || _id == $id)][0]{_id, id, relativePath, rawMarkdown}`,
      { id }
    )

    if (!doc) {
      return json(res, 404, { ok: false, error: 'Not found' })
    }

    const fileName = String(doc.relativePath || doc.id || doc._id || 'artifact.md')
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/[^\w.\-]+/g, '_') || 'artifact.md'

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.end(String(doc.rawMarkdown || ''))
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to download artifact' })
  }
}

