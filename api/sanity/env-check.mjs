import { json, methodNotAllowed } from './_http.mjs'

function present(name) {
  const value = process.env[name]
  return { present: Boolean(value), length: value ? String(value).length : 0 }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)

  json(res, 200, {
    ok: true,
    env: {
      SANITY_PROJECT_ID: present('SANITY_PROJECT_ID'),
      SANITY_DATASET: present('SANITY_DATASET'),
      SANITY_API_VERSION: present('SANITY_API_VERSION'),
      SANITY_READ_TOKEN: present('SANITY_READ_TOKEN'),
      SANITY_WRITE_TOKEN: present('SANITY_WRITE_TOKEN'),
      VITE_DATA_SOURCE: present('VITE_DATA_SOURCE')
    }
  })
}

