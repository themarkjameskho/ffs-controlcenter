import { useEffect, useState } from 'react'
import { dataSource } from './dataSource'

export type ArtifactPreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  content: string
  images: Array<{ filename?: string | null; category?: string | null; title?: string | null; alt?: string | null; url?: string | null; revision?: number | null }> | null
  metrics: {
    qc_status?: string | null
    score_overall?: number | null
    publishable_word_count?: number | null
    h2_count_body?: number | null
    pk_first_paragraph?: boolean | null
    internal_links_count?: number | null
    external_sources_count?: number | null
    content_revision_count?: number | null
    qc_fail_count_before_pass?: number | null
    featured_image_present?: boolean | null
    inline_image_count?: number | null
    infographic_count?: number | null
    image_revision_count?: number | null
  } | null
}

function artifactStaticUrl(relativePath: string) {
  const clean = String(relativePath || '').replace(/^\/+/, '')
  return `/ff_artifacts/${clean}`
}

export function useArtifactPreview(relativePath: string | null) {
  const [state, setState] = useState<ArtifactPreviewState>({ status: 'idle', content: '', images: null, metrics: null })

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!relativePath) {
        setState({ status: 'idle', content: '', images: null, metrics: null })
        return
      }

      setState({ status: 'loading', content: '', images: null, metrics: null })
      try {
        const source = dataSource()
        if (source === 'sanity') {
          const res = await fetch(`/api/sanity/artifact?id=${encodeURIComponent(relativePath)}`, { cache: 'no-store' })
          const payload = (await res.json()) as {
            ok?: boolean
            artifact?: {
              rawMarkdown?: string
              images?: Array<{ filename?: string | null; category?: string | null; title?: string | null; alt?: string | null; url?: string | null; revision?: number | null }> | null
              metrics?: ArtifactPreviewState['metrics']
            }
            error?: string
          }
          if (cancelled) return
          if (!res.ok || !payload.ok) {
            setState({ status: 'error', content: payload.error || 'Failed to load artifact', images: null, metrics: null })
            return
          }
          setState({
            status: 'ready',
            content: String(payload.artifact?.rawMarkdown ?? ''),
            images: payload.artifact?.images ?? null,
            metrics: payload.artifact?.metrics ?? null
          })
        } else if (source === 'static') {
          const res = await fetch(artifactStaticUrl(relativePath), { cache: 'no-store' })
          const content = await res.text()
          if (cancelled) return
          if (!res.ok) {
            setState({ status: 'error', content: content || 'Failed to load artifact', images: null, metrics: null })
            return
          }
          setState({ status: 'ready', content, images: null, metrics: null })
        } else {
          const res = await fetch(`/api/artifact?path=${encodeURIComponent(relativePath)}`, { cache: 'no-store' })
          const payload = (await res.json()) as { ok?: boolean; content?: string; error?: string }
          if (cancelled) return
          if (!res.ok || !payload.ok) {
            setState({ status: 'error', content: payload.error || 'Failed to load artifact', images: null, metrics: null })
            return
          }
          setState({ status: 'ready', content: payload.content || '', images: null, metrics: null })
        }
      } catch {
        if (cancelled) return
        setState({ status: 'error', content: 'Failed to load artifact', images: null, metrics: null })
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [relativePath])

  return state
}

export async function locateArtifact(relativePath: string) {
  if (dataSource() !== 'local') {
    throw new Error('Locate is not available in the online dashboard.')
  }
  const res = await fetch('/api/locate-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relativePath })
  })
  const payload = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to locate file')
  }
}

export function artifactDownloadUrl(relativePath: string) {
  const source = dataSource()
  if (source === 'sanity') {
    return `/api/sanity/artifact-download?id=${encodeURIComponent(relativePath)}`
  }
  if (source === 'static') {
    return artifactStaticUrl(relativePath)
  }
  return `/api/artifact-download?path=${encodeURIComponent(relativePath)}`
}
