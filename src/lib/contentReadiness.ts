import type { DeliverablesArtifact } from './deliverables'

type Metrics = NonNullable<DeliverablesArtifact['metrics']>
type Analysis = NonNullable<DeliverablesArtifact['analysis']>
type Markers = NonNullable<DeliverablesArtifact['markers']>

type ReadinessInput = {
  contentCategory: DeliverablesArtifact['contentCategory']
  metrics?: DeliverablesArtifact['metrics'] | null
  analysis?: DeliverablesArtifact['analysis'] | null
  markers?: DeliverablesArtifact['markers'] | null
  fallbackWordCount?: number | null
  fallbackRevisionCount?: number | null
  fallbackCycleHours?: number | null
}

export type ContentReadiness = {
  status: 'ready' | 'review' | 'blocked'
  statusLabel: string
  issues: string[]
  wordCount: number | null
  qcScore: number | null
  qcStatus: string | null
  revisionCount: number | null
  qcFailCountBeforePass: number | null
  cycleHours: number | null
  featuredImagePresent: boolean | null
  inlineImageCount: number | null
  infographicCount: number | null
  imageAssetCount: number | null
  h2Count: number | null
  internalLinksCount: number | null
  externalSourcesCount: number | null
}

const LONGFORM_CATEGORIES = new Set<DeliverablesArtifact['contentCategory']>(['blog', 'l1', 'l2', 'l3'])

function normalizeQcStatus(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized || null
}

function isQcPassed(value: string | null) {
  return value === 'pass' || value === 'passed' || value === 'approved'
}

function pickNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function pickBoolean(...values: Array<boolean | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return null
}

export function evaluateContentReadiness(input: ReadinessInput): ContentReadiness {
  const metrics = (input.metrics ?? null) as Metrics | null
  const analysis = (input.analysis ?? null) as Analysis | null
  const markers = (input.markers ?? null) as Markers | null
  const longform = LONGFORM_CATEGORIES.has(input.contentCategory)

  const qcStatus = normalizeQcStatus(metrics?.qc_status ?? markers?.qcStatus ?? null)
  const qcScore = pickNumber(metrics?.score_overall)
  const wordCount = pickNumber(metrics?.publishable_word_count, analysis?.wordCount, input.fallbackWordCount)
  const revisionCount = pickNumber(metrics?.content_revision_count, markers?.revisionCount, input.fallbackRevisionCount)
  const qcFailCountBeforePass = pickNumber(metrics?.qc_fail_count_before_pass)
  const cycleHours = pickNumber(input.fallbackCycleHours)
  const featuredImagePresent = pickBoolean(metrics?.featured_image_present)
  const inlineImageCount = pickNumber(metrics?.inline_image_count)
  const infographicCount = pickNumber(metrics?.infographic_count)
  const h2Count = pickNumber(metrics?.h2_count_body)
  const internalLinksCount = pickNumber(metrics?.internal_links_count)
  const externalSourcesCount = pickNumber(metrics?.external_sources_count, analysis?.externalLinkCount)
  const imageAssetCount =
    featuredImagePresent === null && inlineImageCount === null && infographicCount === null
      ? null
      : (featuredImagePresent ? 1 : 0) + (inlineImageCount ?? 0) + (infographicCount ?? 0)

  const blockers: string[] = []
  if (!isQcPassed(qcStatus)) blockers.push('Needs QC pass')

  if (longform) {
    if (featuredImagePresent === false) blockers.push('Missing featured image')
    if (typeof wordCount === 'number' && wordCount < 700) blockers.push('Thin content')
    if (typeof internalLinksCount === 'number' && internalLinksCount < 1) blockers.push('Needs internal link')
    if (typeof externalSourcesCount === 'number' && externalSourcesCount < 1) blockers.push('Needs source')
  } else if (input.contentCategory === 'gmb') {
    if (typeof wordCount === 'number' && wordCount < 80) blockers.push('Thin post')
  }

  const reviewFlags: string[] = []
  if (blockers.length === 0) {
    if (typeof revisionCount === 'number' && revisionCount >= 3) reviewFlags.push('High revisions')
    if (typeof qcFailCountBeforePass === 'number' && qcFailCountBeforePass >= 1) reviewFlags.push('QC rework')
    if (typeof cycleHours === 'number' && cycleHours > 24) reviewFlags.push('Slow turnaround')
  }

  if (blockers.length > 0) {
    return {
      status: 'blocked',
      statusLabel: 'Blocked',
      issues: blockers,
      wordCount,
      qcScore,
      qcStatus,
      revisionCount,
      qcFailCountBeforePass,
      cycleHours,
      featuredImagePresent,
      inlineImageCount,
      infographicCount,
      imageAssetCount,
      h2Count,
      internalLinksCount,
      externalSourcesCount
    }
  }

  if (reviewFlags.length > 0) {
    return {
      status: 'review',
      statusLabel: 'Review',
      issues: reviewFlags,
      wordCount,
      qcScore,
      qcStatus,
      revisionCount,
      qcFailCountBeforePass,
      cycleHours,
      featuredImagePresent,
      inlineImageCount,
      infographicCount,
      imageAssetCount,
      h2Count,
      internalLinksCount,
      externalSourcesCount
    }
  }

  return {
    status: 'ready',
    statusLabel: 'Ready',
    issues: [],
    wordCount,
    qcScore,
    qcStatus,
    revisionCount,
    qcFailCountBeforePass,
    cycleHours,
    featuredImagePresent,
    inlineImageCount,
    infographicCount,
    imageAssetCount,
    h2Count,
    internalLinksCount,
    externalSourcesCount
  }
}
