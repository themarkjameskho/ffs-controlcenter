import { useEffect, useMemo, useState } from 'react'
import { dataSource } from './dataSource'

export type DeliverablesArtifact = {
  id: string
  name: string
  weekBucket: string
  weekNumbers: number[]
  clientSlug: string
  clientName: string
  artifactType: string
  contentCategory: 'blog' | 'qc' | 'gmb' | 'l1' | 'l2' | 'l3' | 'research' | 'other'
  level: 'L1' | 'L2' | 'L3' | 'OTHER'
  workflow: 'draft' | 'qc' | 'research' | 'other'
  date: string | null
  modifiedAt: string
  sizeBytes: number
  relativePath: string
  analysis?: {
    wordCount?: number
    linkCount?: number
    externalLinkCount?: number
    imageCount?: number
    readabilityScore?: number
    seoScore?: number
  } | null
  metrics?: {
    qc_status?: string | null
    score_overall?: number | null
    publishable_word_count?: number | null
    h2_count_body?: number | null
    pk_first_paragraph?: boolean | null
    internal_links_count?: number | null
    external_sources_count?: number | null
    content_revision_count?: number | null
    qc_fail_count_before_pass?: number | null
    qc_artifact_id?: string | null
    featured_image_present?: boolean | null
    inline_image_count?: number | null
    infographic_count?: number | null
    image_revision_count?: number | null
  } | null
  markers?: {
    writerDoneAt?: string | null
    qcDoneAt?: string | null
    qcStatus?: string | null
    publishStatus?: string | null
    publishUpdatedAt?: string | null
    imageStatus?: string | null
    imageUpdatedAt?: string | null
    revisionCount?: number | null
    revisionLastAt?: string | null
  } | null
}

export type DeliverablesClientSummary = {
  slug: string
  name: string
  ordersCreated: number
  blogsCreated: number
  gpp: number
  qc: number
  l1: number
  l2: number
  l3: number
  artifactCount: number
  weeks: string[]
  lastUpdated: string | null
}

type DeliverablesIndexResponse = {
  ok?: boolean
  generatedAt?: string
  weeks?: string[]
  clients?: DeliverablesClientSummary[]
  artifacts?: DeliverablesArtifact[]
}

export type DeliverablesIndexState = {
  loading: boolean
  error: string
  generatedAt: string
  weeks: string[]
  clients: DeliverablesClientSummary[]
  artifacts: DeliverablesArtifact[]
}

const EMPTY_STATE: DeliverablesIndexState = {
  loading: true,
  error: '',
  generatedAt: '',
  weeks: [],
  clients: [],
  artifacts: []
}

export function isTestWeekBucket(value: string) {
  return /(?:^|[_/-])test(?:[_/-]|\d|$)/i.test(String(value ?? ''))
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

function isQcArtifact(artifact: Pick<DeliverablesArtifact, 'workflow' | 'contentCategory'>) {
  return artifact.workflow === 'qc' || artifact.contentCategory === 'qc'
}

async function loadDeliverablesIndex(): Promise<DeliverablesIndexState> {
  const source = dataSource()
  const url =
    source === 'sanity'
      ? '/api/sanity/deliverables-index'
      : source === 'static'
        ? '/ff_state/deliverables-index.json'
        : '/api/deliverables-index'
  const res = await fetch(url, { cache: 'no-store' })
  const payload = (await res.json()) as DeliverablesIndexResponse
  if (!res.ok || payload.ok === false) {
    throw new Error('Failed to load deliverables index')
  }

  return {
    loading: false,
    error: '',
    generatedAt: payload.generatedAt ?? '',
    weeks: Array.isArray(payload.weeks) ? payload.weeks.filter((week) => !isTestWeekBucket(week)) : [],
    clients: sortByName(Array.isArray(payload.clients) ? payload.clients : []),
    artifacts: Array.isArray(payload.artifacts)
      ? payload.artifacts.filter((artifact) => !isQcArtifact(artifact) && !isTestWeekBucket(artifact.weekBucket))
      : []
  }
}

export function useDeliverablesIndex(pollIntervalMs = 12000) {
  const [state, setState] = useState<DeliverablesIndexState>(EMPTY_STATE)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const next = await loadDeliverablesIndex()
        if (!cancelled) {
          setState(next)
        }
      } catch (error) {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load deliverables index'
        }))
      }
    }

    void run()
    const timer = window.setInterval(() => {
      void run()
    }, pollIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollIntervalMs])

  return useMemo(() => state, [state])
}

export function humanizeClientSlug(slug: string) {
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function formatArtifactType(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function formatWorkflow(value: DeliverablesArtifact['workflow']) {
  if (value === 'qc') return 'Quality Check'
  if (value === 'draft') return 'Draft'
  if (value === 'research') return 'Research'
  return 'Other'
}

export function formatContentCategory(value: DeliverablesArtifact['contentCategory']) {
  if (value === 'gmb') return 'GMB/GPP'
  if (value === 'qc') return 'QC'
  if (value === 'blog') return 'Blog'
  if (value === 'research') return 'Research'
  return value.toUpperCase()
}
