import { useEffect, useState } from 'react'
import { dataSource } from './dataSource'

export type ArtifactPreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  content: string
}

function artifactStaticUrl(relativePath: string) {
  const clean = String(relativePath || '').replace(/^\/+/, '')
  return `/ff_artifacts/${clean}`
}

export function useArtifactPreview(relativePath: string | null) {
  const [state, setState] = useState<ArtifactPreviewState>({ status: 'idle', content: '' })

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!relativePath) {
        setState({ status: 'idle', content: '' })
        return
      }

      setState({ status: 'loading', content: '' })
      try {
        const source = dataSource()
        if (source === 'sanity') {
          const res = await fetch(`/api/sanity/artifact?id=${encodeURIComponent(relativePath)}`, { cache: 'no-store' })
          const payload = (await res.json()) as { ok?: boolean; artifact?: { rawMarkdown?: string }; error?: string }
          if (cancelled) return
          if (!res.ok || !payload.ok) {
            setState({ status: 'error', content: payload.error || 'Failed to load artifact' })
            return
          }
          setState({ status: 'ready', content: String(payload.artifact?.rawMarkdown ?? '') })
        } else if (source === 'static') {
          const res = await fetch(artifactStaticUrl(relativePath), { cache: 'no-store' })
          const content = await res.text()
          if (cancelled) return
          if (!res.ok) {
            setState({ status: 'error', content: content || 'Failed to load artifact' })
            return
          }
          setState({ status: 'ready', content })
        } else {
          const res = await fetch(`/api/artifact?path=${encodeURIComponent(relativePath)}`, { cache: 'no-store' })
          const payload = (await res.json()) as { ok?: boolean; content?: string; error?: string }
          if (cancelled) return
          if (!res.ok || !payload.ok) {
            setState({ status: 'error', content: payload.error || 'Failed to load artifact' })
            return
          }
          setState({ status: 'ready', content: payload.content || '' })
        }
      } catch {
        if (cancelled) return
        setState({ status: 'error', content: 'Failed to load artifact' })
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
