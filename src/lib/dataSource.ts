export type DataSource = 'local' | 'static' | 'sanity'

export function dataSource(): DataSource {
  const configured = String(import.meta.env.VITE_DATA_SOURCE ?? '').trim().toLowerCase()
  if (configured === 'sanity') return 'sanity'
  if (import.meta.env.PROD) return 'static'
  return 'local'
}

