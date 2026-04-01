import 'dotenv/config';
import { createClient } from '@sanity/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const {HEATTECH_SANITY_PROJECT_ID:projectId,HEATTECH_SANITY_DATASET:dataset,HEATTECH_SANITY_API_VERSION:apiVersion,HEATTECH_SANITY_WRITE_TOKEN:token}=process.env;
if (!projectId || !dataset || !apiVersion || !token) {
  console.error('Missing HEATTECH_SANITY_* env vars');
  process.exit(2);
}
const client = createClient({ projectId, dataset, apiVersion, token, useCdn:false });

const draftId = process.env.HEATTECH_DRAFT_ID;
if (!draftId) {
  console.error('Set HEATTECH_DRAFT_ID to the drafts.* blogPost id');
  process.exit(2);
}

const imagesDir = process.env.HEATTECH_IMAGES_DIR;
if (!imagesDir) {
  console.error('Set HEATTECH_IMAGES_DIR to the local images folder');
  process.exit(2);
}

const uploads = [
  { key: 'featured', filename: 'featured.jpg', alt: 'Technician preparing a bedroom for bed bug heat treatment with a simple checklist.' },
  { key: 'img01', filename: 'img-01.jpg', alt: 'Sealed bags and labeled bins for laundry prep before bed bug heat treatment.' },
  { key: 'img02', filename: 'img-02.jpg', alt: 'Clear floor space and a bed moved from the wall to help technicians access baseboards.' },
  { key: 'img03', filename: 'img-03.jpg', alt: 'Common heat-sensitive items set aside with a note to ask the technician before treatment.' },
];

async function uploadImage(filePath) {
  const stream = fs.createReadStream(filePath);
  const res = await client.assets.upload('image', stream, { filename: path.basename(filePath) });
  return res._id;
}

const assetIds = {};
for (const u of uploads) {
  const fp = path.join(imagesDir, u.filename);
  assetIds[u.key] = await uploadImage(fp);
}

const doc = await client.getDocument(draftId);
if (!doc) throw new Error('Draft not found');

const mkKey = () => crypto.randomBytes(6).toString('hex');
const imgBlock = (assetId) => ({
  _key: mkKey(),
  _type: 'image',
  asset: { _type: 'reference', _ref: assetId },
});

let content = Array.isArray(doc.content) ? [...doc.content] : [];

const hasImageRef = (ref) => content.some(b => b?._type === 'image' && b.asset?._ref === ref);

function textOf(b){
  return (b?.children?.map(c=>c.text).join('') || '').trim();
}

function findHeadingIndexContains(substr) {
  const s = substr.toLowerCase();
  return content.findIndex(b =>
    b?._type === 'block' &&
    (b.style === 'h2' || b.style === 'h3') &&
    textOf(b).toLowerCase().includes(s)
  );
}

// Never place inline images after Sources.
const sourcesIdx = findHeadingIndexContains('sources');
// If prior runs inserted images after Sources, remove them.
if (sourcesIdx >= 0) {
  const before = content.slice(0, sourcesIdx);
  const after = content.slice(sourcesIdx).filter(b => b?._type !== 'image');
  content = [...before, ...after];
}
const safeEnd = sourcesIdx >= 0 ? content.findIndex(b => b?._type==='block' && (b.style==='h2'||b.style==='h3') && textOf(b).toLowerCase().includes('sources')) : content.length;

function safeInsert(afterIdx, block){
  const idx = Math.min(afterIdx + 1, safeEnd);
  content.splice(idx, 0, block);
}

// Preferred placements: after specific headings (H2/H3) if present.
const idxLaundry = findHeadingIndexContains('laundry');
const idxSensitive = findHeadingIndexContains('heat-sensitive');

if (!hasImageRef(assetIds.img01) && idxLaundry >= 0 && idxLaundry < safeEnd) safeInsert(idxLaundry, imgBlock(assetIds.img01));
if (!hasImageRef(assetIds.img03) && idxSensitive >= 0 && idxSensitive < safeEnd) safeInsert(idxSensitive, imgBlock(assetIds.img03));

// Place declutter/access image after the first non-Sources heading.
if (!hasImageRef(assetIds.img02)) {
  const firstHeading = content.findIndex((b, i) => b?._type==='block' && (b.style==='h2' || b.style==='h3') && i < safeEnd);
  if (firstHeading >= 0) safeInsert(firstHeading, imgBlock(assetIds.img02));
}

// Fallback: if we still don't have all 3 inline images, distribute them before Sources.
const needed = [
  { ref: assetIds.img01, block: imgBlock(assetIds.img01), pos: 0.25 },
  { ref: assetIds.img02, block: imgBlock(assetIds.img02), pos: 0.50 },
  { ref: assetIds.img03, block: imgBlock(assetIds.img03), pos: 0.75 },
].filter(x => !hasImageRef(x.ref));

if (needed.length) {
  const pre = content.slice(0, safeEnd);
  for (const n of needed) {
    const insertAt = Math.max(0, Math.min(pre.length - 1, Math.floor(pre.length * n.pos)));
    content.splice(insertAt, 0, n.block);
  }
}

const featuredImage = {
  _type: 'image',
  alt: uploads[0].alt,
  asset: { _type: 'reference', _ref: assetIds.featured }
};

const patch = {
  featuredImage,
  seo: {
    ...(doc.seo || {}),
    ogImage: featuredImage
  },
  content
};

const res = await client.patch(draftId).set(patch).commit();

console.log(JSON.stringify({
  ok: true,
  draftId,
  featuredAsset: assetIds.featured,
  inlineAssets: [assetIds.img01, assetIds.img02, assetIds.img03],
  contentBlocks: res.content?.length,
  featuredImage: !!res.featuredImage,
  ogImage: !!res.seo?.ogImage
}, null, 2));
