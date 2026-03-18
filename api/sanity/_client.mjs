import { createClient } from '@sanity/client'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }
  return value
}

export function sanityClient({ mode }) {
  const projectId = requiredEnv('SANITY_PROJECT_ID')
  const dataset = requiredEnv('SANITY_DATASET')
  const apiVersion = requiredEnv('SANITY_API_VERSION')
  const token = mode === 'write' ? process.env.SANITY_WRITE_TOKEN : process.env.SANITY_READ_TOKEN

  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
    token
  })
}

