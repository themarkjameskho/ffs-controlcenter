import { sanityClient } from './_client.mjs'
import { json, methodNotAllowed } from './_http.mjs'
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const FALLBACK_PATH = path.resolve(REPO_ROOT, 'public', 'ff_state', 'production-metrics.json')

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
    const snapshot = await client.fetch(`*[_id == "ffstate-production-metrics"][0]{generatedAt, windows}`)
    if (snapshot) {
      return json(res, 200, {
        ok: true,
        generatedAt: String(snapshot.generatedAt ?? new Date().toISOString()),
        windows: Array.isArray(snapshot.windows) ? snapshot.windows : []
      })
    }

    const fallback = readFallback()
    json(res, 200, {
      ok: true,
      generatedAt: String(fallback.generatedAt ?? new Date().toISOString()),
      windows: Array.isArray(fallback.windows) ? fallback.windows : []
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to load production metrics' })
  }
}
