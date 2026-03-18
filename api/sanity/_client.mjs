import { createClient } from '@sanity/client'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }
  return value
}

function sanitizeToken(name, token) {
  if (!token) return null
  const trimmed = String(token).trim()
  if (!trimmed) return null
  // HTTP headers must be plain ASCII without control characters.
  if (/[^\x21-\x7E]/.test(trimmed)) {
    throw new Error(`${name} contains invalid characters (whitespace/non-ASCII). Re-copy the token and redeploy.`)
  }
  return trimmed
}

export function sanityClient({ mode }) {
  const projectId = requiredEnv('SANITY_PROJECT_ID')
  const dataset = requiredEnv('SANITY_DATASET')
  const apiVersion = requiredEnv('SANITY_API_VERSION')
  const token =
    mode === 'write' ? sanitizeToken('SANITY_WRITE_TOKEN', process.env.SANITY_WRITE_TOKEN) : sanitizeToken('SANITY_READ_TOKEN', process.env.SANITY_READ_TOKEN)

  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
    token
  })
}
