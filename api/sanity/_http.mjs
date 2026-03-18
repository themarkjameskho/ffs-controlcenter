export function json(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function badRequest(res, message) {
  json(res, 400, { ok: false, error: message })
}

export function methodNotAllowed(res) {
  json(res, 405, { ok: false, error: 'Method not allowed' })
}

