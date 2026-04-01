import type { ContentReadiness } from '../lib/contentReadiness'

type Props = {
  readiness: ContentReadiness
}

function valueLabel(value: string | number | null | undefined, suffix = '') {
  if (value === null || value === undefined || value === '') return '—'
  return `${value}${suffix}`
}

export default function ArtifactMetricsSummary({ readiness }: Props) {
  return (
    <div className="artifact-modal-stack">
      <section className="artifact-status-banner">
        <p className="eyebrow">Publish Status</p>
        <h4>{readiness.statusLabel}</h4>
        <p className="subhead">
          {readiness.issues.length > 0 ? readiness.issues.join(' · ') : 'Ready for publish handoff'}
        </p>
      </section>

      <section className="artifact-metric-grid">
        <article className="artifact-metric-card">
          <span>QC Score</span>
          <strong>{valueLabel(readiness.qcScore, ' / 10')}</strong>
          <p>Status {valueLabel(readiness.qcStatus)}</p>
        </article>
        <article className="artifact-metric-card">
          <span>Words</span>
          <strong>{valueLabel(readiness.wordCount)}</strong>
          <p>Publishable body</p>
        </article>
        <article className="artifact-metric-card">
          <span>Cycle Time</span>
          <strong>{valueLabel(readiness.cycleHours, 'h')}</strong>
          <p>Writer → QC pass</p>
        </article>
        <article className="artifact-metric-card">
          <span>Revisions</span>
          <strong>{valueLabel(readiness.revisionCount)}</strong>
          <p>QC rework {valueLabel(readiness.qcFailCountBeforePass)}</p>
        </article>
        <article className="artifact-metric-card">
          <span>Featured Image</span>
          <strong>
            {readiness.featuredImagePresent === null ? '—' : readiness.featuredImagePresent ? 'Yes' : 'No'}
          </strong>
          <p>Assets {valueLabel(readiness.imageAssetCount)}</p>
        </article>
        <article className="artifact-metric-card">
          <span>Structure</span>
          <strong>H2 {valueLabel(readiness.h2Count)}</strong>
          <p>Links {valueLabel(readiness.internalLinksCount)} · Sources {valueLabel(readiness.externalSourcesCount)}</p>
        </article>
      </section>

      <section className="artifact-section-card artifact-section-card-compact">
        <h4>Publish Checklist</h4>
        <ul className="artifact-checklist">
          <li>
            <span>QC status</span>
            <strong>{valueLabel(readiness.qcStatus)}</strong>
          </li>
          <li>
            <span>Featured image</span>
            <strong>{readiness.featuredImagePresent === null ? '—' : readiness.featuredImagePresent ? 'Ready' : 'Missing'}</strong>
          </li>
          <li>
            <span>Internal links</span>
            <strong>{valueLabel(readiness.internalLinksCount)}</strong>
          </li>
          <li>
            <span>Sources</span>
            <strong>{valueLabel(readiness.externalSourcesCount)}</strong>
          </li>
        </ul>
      </section>
    </div>
  )
}
