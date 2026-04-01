import 'dotenv/config';
import { createClient } from '@sanity/client';

const projectId = process.env.HEATTECH_SANITY_PROJECT_ID;
const dataset = process.env.HEATTECH_SANITY_DATASET;
const apiVersion = process.env.HEATTECH_SANITY_API_VERSION || '2026-03-24';
const token = process.env.HEATTECH_SANITY_WRITE_TOKEN;

if (!projectId || !dataset || !token) {
  console.error('Missing HEATTECH_SANITY_PROJECT_ID / HEATTECH_SANITY_DATASET / HEATTECH_SANITY_WRITE_TOKEN');
  process.exit(2);
}

const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });

const q = `*[_type != "system" && !(_id in path("drafts.**"))] | order(_updatedAt desc)[0...5]{_id,_type,title,slug, _updatedAt}`;
const docs = await client.fetch(q);
console.log(JSON.stringify({ projectId, dataset, apiVersion, sample: docs }, null, 2));

if (docs[0]?._id) {
  const full = await client.getDocument(docs[0]._id);
  const keys = Object.keys(full || {}).sort();
  console.log('\nTOP DOC KEYS:', keys);
  // Print shallow shapes for non-primitive fields
  const shape = {};
  for (const k of keys) {
    const v = full[k];
    if (v && typeof v === 'object') {
      shape[k] = Array.isArray(v) ? { type: 'array', len: v.length, firstType: v[0]?._type || typeof v[0] } : { type: 'object', keys: Object.keys(v).slice(0, 20) };
    }
  }
  console.log('\nTOP DOC SHAPES:', JSON.stringify(shape, null, 2));
}
