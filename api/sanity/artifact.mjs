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
      `*[_type == "artifact" && (id == $id || _id == $id)][0]{
        _id,
        id,
        title,
        clientSlug,
        clientName,
        weekBucket,
        weekNumbers,
        artifactType,
        contentCategory,
        level,
        workflow,
        date,
        modifiedAt,
        sizeBytes,
        relativePath,
        rawMarkdown,
        body,
        qcResult
      }`,
      { id }
    )

    if (!doc) {
      return json(res, 404, { ok: false, error: 'Not found' })
    }

    json(res, 200, {
      ok: true,
      artifact: {
        id: String(doc.id ?? doc._id ?? id),
        title: doc.title ?? null,
        rawMarkdown: doc.rawMarkdown ?? '',
        body: doc.body ?? null,
        qcResult: doc.qcResult ?? null
      }
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load artifact' })
  }
}

