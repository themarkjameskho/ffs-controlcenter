import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { artifactDownloadUrl, locateArtifact, useArtifactPreview } from '../lib/artifact'
import type { DeliverablesArtifact, DeliverablesIndexState } from '../lib/deliverables'
import { formatContentCategory, humanizeClientSlug } from '../lib/deliverables'
import { dataSource } from '../lib/dataSource'

type ClientDashboardProps = {
  deliverables: DeliverablesIndexState
}

function dateOnly(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function computeBodyWordCount(markdown: string): number | null {
  const md = String(markdown || '')
  const start = md.search(/^##\s+body_content\s*$/m)
  if (start === -1) return null
  const rest = md.slice(start)
  const next = rest.slice('## body_content'.length).search(/^##\s+/m)
  const body = (next === -1 ? rest : rest.slice(0, '## body_content'.length + next)).replace(/^##\s+body_content\s*$/m, '')
  const cleaned = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[Internal Link:[^\]]*\]/g, ' ')
    .replace(/https?:\/\/[^\s)\]]+/g, ' ')
    .replace(/[#>*_`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.split(' ').length : 0
}

function dateLabel(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function dateTimeLabel(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function artifactMomentValue(artifact: DeliverablesArtifact) {
  const anchor = artifact.date ?? artifact.modifiedAt
  const stamp = Date.parse(anchor)
  if (!Number.isFinite(stamp)) return 0
  return stamp
}

type ContentFilter = 'all' | DeliverablesArtifact['contentCategory']

export default function ClientDashboard({ deliverables }: ClientDashboardProps) {
  const { clientSlug = '' } = useParams()
  const [nameQuery, setNameQuery] = useState('')
  const [weekBucket, setWeekBucket] = useState('all')
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [selectedArtifact, setSelectedArtifact] = useState<DeliverablesArtifact | null>(null)
  const [locateMessage, setLocateMessage] = useState('')
  const [locating, setLocating] = useState(false)

  const client = useMemo(() => {
    return deliverables.clients.find((entry) => entry.slug === clientSlug) ?? null
  }, [clientSlug, deliverables.clients])

  const clientArtifacts = useMemo(() => {
    return deliverables.artifacts.filter((artifact) => artifact.clientSlug === clientSlug)
  }, [clientSlug, deliverables.artifacts])

  const weekBuckets = useMemo(() => {
    return Array.from(new Set(clientArtifacts.map((artifact) => artifact.weekBucket))).sort((a, b) => a.localeCompare(b))
  }, [clientArtifacts])

  const filteredArtifacts = useMemo(() => {
    const nameNeedle = nameQuery.trim().toLowerCase()
    const fromStamp = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : null
    const toStamp = dateTo ? Date.parse(`${dateTo}T23:59:59`) : null

    const next = clientArtifacts.filter((artifact) => {
      if (nameNeedle) {
        const haystack = `${artifact.name} ${artifact.relativePath}`.toLowerCase()
        if (!haystack.includes(nameNeedle)) return false
      }
      if (weekBucket !== 'all' && artifact.weekBucket !== weekBucket) return false
      if (contentFilter !== 'all' && artifact.contentCategory !== contentFilter) return false

      const artifactStamp = artifactMomentValue(artifact)
      if (fromStamp && artifactStamp < fromStamp) return false
      if (toStamp && artifactStamp > toStamp) return false
      return true
    })

    if (sortBy === 'name') {
      next.sort((a, b) => a.name.localeCompare(b.name))
      return next
    }

    next.sort((a, b) => artifactMomentValue(a) - artifactMomentValue(b))
    if (sortBy === 'newest') next.reverse()
    return next
  }, [clientArtifacts, contentFilter, dateFrom, dateTo, nameQuery, sortBy, weekBucket])

  const previewKey = selectedArtifact ? (dataSource() === 'sanity' ? selectedArtifact.id : selectedArtifact.relativePath) : null
  const preview = useArtifactPreview(previewKey)
  const publishableWordCount =
    typeof preview.metrics?.publishable_word_count === 'number'
      ? preview.metrics.publishable_word_count
      : preview.status === 'ready'
        ? computeBodyWordCount(preview.content)
        : null

  return (
    <div className="page-shell">
      <header className="page-head">
        <div>
          <p className="eyebrow">Client Dashboard</p>
          <h1>{client?.name ?? humanizeClientSlug(clientSlug)}</h1>
          <p className="subhead">Per-client delivery metrics + artifact manager</p>
        </div>
        <div className="masthead-meta">
          <span className="meta-pill">Files: {clientArtifacts.length}</span>
          <span className="meta-pill">Updated: {dateTimeLabel(client?.lastUpdated ?? null)}</span>
        </div>
      </header>

      {deliverables.loading ? <p className="subhead">Scanning deliverables…</p> : null}
      {deliverables.error ? <p className="subhead">{deliverables.error}</p> : null}
      {!deliverables.loading && !client ? <p className="subhead">Client not found in current index.</p> : null}

      {client && (
        <>
          <section className="summary-row">
            <article>
              <p>Orders Created</p>
              <h2>{client.ordersCreated}</h2>
            </article>
            <article>
              <p>Blogs Created</p>
              <h2>{client.blogsCreated}</h2>
            </article>
            <article>
              <p>GMB</p>
              <h2>{client.gpp}</h2>
            </article>
            <article>
              <p>QC</p>
              <h2>{client.qc}</h2>
            </article>
            <article>
              <p>L1</p>
              <h2>{client.l1}</h2>
            </article>
            <article>
              <p>L2</p>
              <h2>{client.l2}</h2>
            </article>
            <article>
              <p>L3</p>
              <h2>{client.l3}</h2>
            </article>
          </section>

          <section className="panel-card">
            <header className="panel-card-head">
              <h3>Artifacts</h3>
              <span>{filteredArtifacts.length} matching file(s)</span>
            </header>

            <div className="artifact-filters" role="group" aria-label="Artifact filters">
              <label>
                Name
                <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder="Search artifact name" />
              </label>
              <label>
                Week Folder
                <select value={weekBucket} onChange={(e) => setWeekBucket(e.target.value)}>
                  <option value="all">All folders</option>
                  {weekBuckets.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Content
                <select value={contentFilter} onChange={(e) => setContentFilter(e.target.value as ContentFilter)}>
                  <option value="all">All content</option>
                  <option value="blog">Blog</option>
                  <option value="gmb">GMB</option>
                  <option value="l1">L1</option>
                  <option value="l2">L2</option>
                  <option value="l3">L3</option>
                  <option value="qc">QC</option>
                  <option value="research">Research</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Date From
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label>
                Date To
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <label>
                Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name')}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>

            <div className="artifact-table-wrap">
              <table className="artifact-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Content</th>
                    <th>Week Folder</th>
                    <th>Date</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArtifacts.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No files match the current filters.</td>
                    </tr>
                  ) : (
                    filteredArtifacts.map((artifact) => (
                      <tr
                        key={artifact.id}
                        className={selectedArtifact?.id === artifact.id ? 'is-selected' : ''}
                        onClick={() => {
                          setLocateMessage('')
                          setSelectedArtifact(artifact)
                        }}
                      >
                        <td>{artifact.name}</td>
                        <td>{formatContentCategory(artifact.contentCategory)}</td>
                        <td>{artifact.weekBucket}</td>
                        <td>{dateLabel(artifact.date ?? dateOnly(artifact.modifiedAt))}</td>
                        <td>{dateTimeLabel(artifact.modifiedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selectedArtifact
            ? createPortal(
                <section
                  className="item-modal-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Artifact preview"
                  onClick={() => {
                    setLocateMessage('')
                    setSelectedArtifact(null)
                  }}
                >
                  <article className="item-modal" onClick={(e) => e.stopPropagation()}>
                    <header className="item-modal-head">
                      <h3>{selectedArtifact.name}</h3>
                      <button
                        type="button"
                        className="item-modal-close"
                        onClick={() => {
                          setLocateMessage('')
                          setSelectedArtifact(null)
                        }}
                      >
                        Close
                      </button>
                    </header>
                    <p className="subhead" style={{ marginTop: 0 }}>
                      {selectedArtifact.relativePath}
                    </p>
                    <p className="subhead">
                      {formatContentCategory(selectedArtifact.contentCategory)} · {selectedArtifact.weekBucket}
                    </p>
                    {preview.metrics || selectedArtifact.analysis ? (
                      <p className="subhead">
                        QC {preview.metrics?.score_overall ?? '—'} / 10 · Status {preview.metrics?.qc_status ?? selectedArtifact.markers?.qcStatus ?? '—'} · Words{' '}
                        {publishableWordCount ?? selectedArtifact.analysis?.wordCount ?? '—'} · H2s {preview.metrics?.h2_count_body ?? '—'} · Internal links{' '}
                        {preview.metrics?.internal_links_count ?? '—'} · Sources {preview.metrics?.external_sources_count ?? '—'}
                      </p>
                    ) : null}
                    {preview.metrics ? (
                      <p className="subhead">
                        Revisions {preview.metrics.content_revision_count ?? '—'} · QC fails before pass {preview.metrics.qc_fail_count_before_pass ?? '—'} · Featured image{' '}
                        {preview.metrics.featured_image_present ? 'Yes' : 'No'} · Inline images {preview.metrics.inline_image_count ?? '—'} · Infographics{' '}
                        {preview.metrics.infographic_count ?? '—'}
                      </p>
                    ) : null}
                    {preview.images && preview.images.length > 0 ? (
                      <section style={{ marginTop: 12 }}>
                        <h4 style={{ margin: '8px 0' }}>Images</h4>
                        <ul className="plain-list">
                          {preview.images.map((img, idx) => (
                            <li key={`${img.url ?? img.filename ?? idx}`}>
                              {img.url ? (
                                <a href={img.url} target="_blank" rel="noreferrer">
                                  {img.filename ?? `image-${idx + 1}`}
                                </a>
                              ) : (
                                <span>{img.filename ?? `image-${idx + 1}`}</span>
                              )}
                              {img.category ? <span className="subhead"> · {img.category}</span> : null}
                              {typeof img.revision === 'number' ? <span className="subhead"> · rev {img.revision}</span> : null}
                              {img.alt ? <div className="subhead">Alt: {img.alt}</div> : null}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <div className="preview-actions">
                      <a className="action-btn" href={artifactDownloadUrl(previewKey ?? selectedArtifact.relativePath)}>
                        Download
                      </a>
                      {!import.meta.env.PROD ? (
                        <>
                          <button
                            type="button"
                            className="action-btn"
                            disabled={locating}
                            onClick={async () => {
                              try {
                                setLocating(true)
                                setLocateMessage('')
                                await locateArtifact(selectedArtifact.relativePath)
                                setLocateMessage('Opened file location.')
                              } catch (error) {
                                setLocateMessage(error instanceof Error ? error.message : 'Failed to locate file')
                              } finally {
                                setLocating(false)
                              }
                            }}
                          >
                            {locating ? 'Locating…' : 'Locate File'}
                          </button>
                          {locateMessage ? <span className="subhead">{locateMessage}</span> : null}
                        </>
                      ) : null}
                    </div>
                    {preview.status === 'loading' ? <p className="subhead">Loading artifact…</p> : null}
                    {preview.status === 'error' ? <pre className="artifact-preview">{preview.content}</pre> : null}
                    {preview.status === 'ready' && selectedArtifact.contentCategory !== 'qc' ? <pre className="artifact-preview">{preview.content}</pre> : null}
                    {preview.status === 'ready' && selectedArtifact.contentCategory === 'qc' ? (
                      <p className="subhead">QC file is available via download. Metrics above are the primary summary.</p>
                    ) : null}
                  </article>
                </section>,
                document.body,
              )
            : null}
        </>
      )}
    </div>
  )
}
