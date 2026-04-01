import { sanityClient } from './_client.mjs'
import { json, methodNotAllowed } from './_http.mjs'

function sortByName(items) {
  return [...items].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)

  try {
    const client = sanityClient({ mode: 'read' })

    const [clients, artifacts] = await Promise.all([
      client.fetch(`*[_type == "client"] | order(name asc) {slug, name}`),
      client.fetch(
        `*[_type == "artifact"] | order(coalesce(date, modifiedAt) desc) {
          _id,
          id,
          name,
          weekBucket,
          weekNumbers,
          clientSlug,
          clientName,
          artifactType,
          contentCategory,
          level,
          workflow,
          date,
          modifiedAt,
          sizeBytes,
          relativePath,
          analysis{
            wordCount,
            linkCount,
            externalLinkCount,
            imageCount,
            readabilityScore,
            seoScore
          },
          markers{
            writerDoneAt,
            qcDoneAt,
            qcStatus,
            publishStatus,
            publishUpdatedAt,
            imageStatus,
            imageUpdatedAt,
            revisionCount,
            revisionLastAt
          }
        }`
      )
    ])

    const normalizedClients = sortByName(
      (Array.isArray(clients) ? clients : []).map((c) => ({
        slug: String(c.slug ?? ''),
        name: String(c.name ?? '')
      }))
    ).filter((c) => c.slug)

    const normalizedArtifacts = (Array.isArray(artifacts) ? artifacts : []).map((a) => ({
      id: String(a.id ?? a._id ?? ''),
      name: String(a.name ?? ''),
      weekBucket: String(a.weekBucket ?? ''),
      weekNumbers: Array.isArray(a.weekNumbers) ? a.weekNumbers : [],
      clientSlug: String(a.clientSlug ?? ''),
      clientName: String(a.clientName ?? a.clientSlug ?? ''),
      artifactType: String(a.artifactType ?? ''),
      contentCategory: String(a.contentCategory ?? 'other'),
      level: String(a.level ?? 'OTHER'),
      workflow: String(a.workflow ?? 'other'),
      date: a.date ?? null,
      modifiedAt: String(a.modifiedAt ?? ''),
      sizeBytes: Number(a.sizeBytes ?? 0),
      relativePath: String(a.relativePath ?? ''),
      analysis: a.analysis ?? null,
      markers: a.markers ?? null
    }))

    const weekBuckets = Array.from(new Set(normalizedArtifacts.map((a) => a.weekBucket).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    )

    json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      weeks: weekBuckets,
      clients: normalizedClients,
      artifacts: normalizedArtifacts
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to build deliverables index' })
  }
}
