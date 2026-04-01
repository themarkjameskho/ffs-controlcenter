import 'dotenv/config';
import { createClient } from '@sanity/client';
import fs from 'fs';
import path from 'path';

const { SANITY_PROJECT_ID: projectId, SANITY_DATASET: dataset, SANITY_API_VERSION: apiVersion, SANITY_WRITE_TOKEN: token } = process.env;
if (!projectId || !dataset || !apiVersion || !token) {
  console.error('Missing SANITY_* env vars for Control Center project');
  process.exit(2);
}

const relativePath = String(process.env.CONTROL_CENTER_RELATIVE_PATH || '').trim();
if (!relativePath) {
  console.error('Set CONTROL_CENTER_RELATIVE_PATH to the artifact relativePath (deliverables/...)');
  process.exit(2);
}

const imagesDir = String(process.env.CONTROL_CENTER_IMAGES_DIR || '').trim();
if (!imagesDir) {
  console.error('Set CONTROL_CENTER_IMAGES_DIR to the local images folder');
  process.exit(2);
}

const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });

async function uploadImage(filePath) {
  const stream = fs.createReadStream(filePath);
  const res = await client.assets.upload('image', stream, { filename: path.basename(filePath) });
  return res._id;
}

// Find artifact doc by relativePath
const artifact = await client.fetch(`*[_type=="artifact" && relativePath==$p][0]{_id,relativePath,images}`, { p: relativePath });
if (!artifact?._id) {
  console.error(JSON.stringify({ ok: false, error: 'Artifact not found for relativePath', relativePath }, null, 2));
  process.exit(3);
}

// Expected filenames (deterministic)
const files = [
  { filename: 'featured.jpg', category: 'featured_thumbnail' },
  { filename: 'img-01.jpg', category: 'supporting_photo' },
  { filename: 'img-02.jpg', category: 'supporting_photo' },
  { filename: 'img-03.jpg', category: 'supporting_photo' }
];

const images = [];
for (const f of files) {
  const fp = path.join(imagesDir, f.filename);
  if (!fs.existsSync(fp)) continue;
  const assetId = await uploadImage(fp);
  images.push({
    _type: 'artifactImage',
    filename: f.filename,
    category: f.category,
    // title + alt should come from Writer; we attach later when available.
    title: null,
    alt: null,
    asset: { _type: 'image', asset: { _type: 'reference', _ref: assetId } }
  });
}

await client.patch(artifact._id).set({ images }).commit();

console.log(JSON.stringify({ ok: true, artifactId: artifact._id, relativePath, imageCount: images.length }, null, 2));
