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
        qcResult,
        metrics{
          qc_status,
          score_overall,
          publishable_word_count,
          h2_count_body,
          pk_first_paragraph,
          internal_links_count,
          external_sources_count,
          content_revision_count,
          qc_fail_count_before_pass,
          qc_artifact_id,
          featured_image_present,
          inline_image_count,
          infographic_count,
          image_revision_count
        },
        images[]{
          filename,
          category,
          title,
          alt,
          revision,
          "url": asset.asset->url
        }
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
        qcResult: doc.qcResult ?? null,
        metrics: doc.metrics ?? null,
        images: doc.images ?? null
      }
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load artifact' })
  }
}
