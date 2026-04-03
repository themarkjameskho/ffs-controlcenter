import { sanityClient } from './_client.mjs'
import { json, methodNotAllowed } from './_http.mjs'
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const FALLBACK_PATH = path.resolve(REPO_ROOT, 'public', 'ff_state', 'dashboard-updates.json')

function readFallback() {
  try {
    return JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'))
  } catch {
    return {}
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)

  try {
    const client = sanityClient({ mode: 'read' })
    const fallback = readFallback()
    const docs = await client.fetch(
      `*[_type == "updateLog"] | order(timestamp desc)[0...30]{
        _id,
        id,
        kind,
        severity,
        title,
        summary,
        detail,
        body,
        timestamp,
        relatedFiles,
        generatedAt
      }`
    )

    const entries = (Array.isArray(docs) ? docs : []).map((doc) => ({
      id: String(doc.id ?? doc._id ?? ''),
      kind: String(doc.kind ?? 'audit'),
      severity: String(doc.severity ?? 'info'),
      title: String(doc.title ?? ''),
      summary: String(doc.summary ?? ''),
      detail: String(doc.detail ?? ''),
      body: String(doc.body ?? ''),
      timestamp: String(doc.timestamp ?? ''),
      relatedFiles: Array.isArray(doc.relatedFiles) ? doc.relatedFiles.map((file) => String(file)) : []
    }))

    json(res, 200, {
      ok: true,
      generatedAt: String(docs?.[0]?.generatedAt ?? fallback.generatedAt ?? new Date().toISOString()),
      ordersGeneratedAt: String(fallback.ordersGeneratedAt ?? ''),
      activeOrderLabels: Array.isArray(fallback.activeOrderLabels) ? fallback.activeOrderLabels : [],
      liveUpdatedAt: String(fallback.liveUpdatedAt ?? ''),
      livePatchCount: Number(fallback.livePatchCount ?? 0),
      weeks: Array.isArray(fallback.weeks) ? fallback.weeks : [],
      entries
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load update logs' })
  }
}
