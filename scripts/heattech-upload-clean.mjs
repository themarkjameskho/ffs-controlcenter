import 'dotenv/config';
import { createClient } from '@sanity/client';
import fs from 'fs';
import crypto from 'crypto';

const {HEATTECH_SANITY_PROJECT_ID:projectId,HEATTECH_SANITY_DATASET:dataset,HEATTECH_SANITY_API_VERSION:apiVersion,HEATTECH_SANITY_WRITE_TOKEN:token}=process.env;
if (!projectId || !dataset || !apiVersion || !token) {
  console.error('Missing HEATTECH_SANITY_* env vars');
  process.exit(2);
}
const client = createClient({ projectId, dataset, apiVersion, token, useCdn:false });
// Important: default perspective is "published"; duplication checks must see drafts too.
const clientPreview = client.withConfig({ perspective: 'previewDrafts' });

const mdPath = process.env.HEATTECH_MD_PATH;
if (!mdPath) {
  console.error('Set HEATTECH_MD_PATH to the *_draft.md file to upload');
  process.exit(2);
}
const md = fs.readFileSync(mdPath, 'utf8');

function getSection(name){
  const re = new RegExp(`^##\\s+${name}\\s*$`, 'm');
  const m = md.match(re);
  if(!m) return '';
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const end = rest.search(/^##\s+/m);
  return (end===-1?rest:rest.slice(0,end)).trim();
}

const titleTag = getSection('title_tag');
const metaDesc = getSection('meta_description');
const slugStr = getSection('url_slug');
const bodyMd = getSection('body_content');
const faqMd = getSection('faq');
const sourcesMd = getSection('Sources');

function mkKey(){return crypto.randomBytes(6).toString('hex');}
function cleanInline(s){
  return String(s||'')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1');
}

function block(style, text){
  return {
    _key: mkKey(),
    _type: 'block',
    style,
    markDefs: [],
    children: [{ _key: mkKey(), _type:'span', marks:[], text: cleanInline(text) }]
  };
}

function mdToPT(mdText){
  const lines = mdText.split(/\r?\n/);
  const blocks=[];
  let para=[];
  const flush=()=>{
    const t=cleanInline(para.join(' ').replace(/\s+/g,' ').trim());
    if(t) blocks.push(block('normal', t));
    para=[];
  };
  for(const line of lines){
    const l=line.trim();
    if(!l){ flush(); continue; }
    if(l.startsWith('# ')){ flush(); blocks.push(block('h1', l.slice(2).trim())); continue; }
    if(l.startsWith('## ')){ flush(); blocks.push(block('h2', l.slice(3).trim())); continue; }
    if(l.startsWith('### ')){ flush(); blocks.push(block('h3', l.slice(4).trim())); continue; }
    if(l.startsWith('- ')){
      flush();
      blocks.push({
        _key: mkKey(),
        _type:'block',
        style:'normal',
        listItem:'bullet',
        level:1,
        markDefs:[],
        children:[{_key:mkKey(),_type:'span',marks:[],text:cleanInline(l.slice(2).trim())}]
      });
      continue;
    }
    para.push(l);
  }
  flush();
  return blocks;
}

const contentBlocks = [
  ...mdToPT(bodyMd),
  ...mdToPT(faqMd),
  ...(sourcesMd ? [block('h2','Sources'), ...mdToPT(sourcesMd)] : [])
];

const newId = 'drafts.' + crypto.randomUUID();
function ref(_ref){
  return { _key: mkKey(), _type: 'reference', _ref };
}

async function ensureTag(tagId, name, slugCurrent){
  const existing = await client.getDocument(tagId);
  if (existing) return tagId;
  await client.create({ _id: tagId, _type: 'tag', name, slug: { _type: 'slug', current: slugCurrent } });
  return tagId;
}

// Default Heat Tech taxonomy for bed-bug heat-treatment prep content
await ensureTag('tag-tulsa', 'Tulsa', 'tulsa');
await ensureTag('tag-heat-treatment-prep', 'Heat treatment prep', 'heat-treatment-prep');
// tag-bed-bug-heat-treatment already exists in this dataset, but safe to ensure
await ensureTag('tag-bed-bug-heat-treatment', 'Bed bug heat treatment', 'bed-bug-heat-treatment');

// Duplication hard gate (BLK.DUPE.001)
const existingTitleCount = await clientPreview.fetch('count(*[_type=="blogPost" && title==$t])', { t: titleTag });
if (existingTitleCount > 0) {
  console.error(JSON.stringify({ ok:false, blocker:'BLK.DUPE.001', reason:'Duplicate title already exists in Sanity', title:titleTag }, null, 2));
  process.exit(3);
}

let slugCurrent = slugStr;
// Ensure uniqueness (Sanity requires unique slugs).
const existingCount = await clientPreview.fetch('count(*[_type=="blogPost" && slug.current==$s])', { s: slugCurrent });
if (existingCount > 0) slugCurrent = `${slugCurrent}-${existingCount + 1}`;

const doc = {
  _id: newId,
  _type: 'blogPost',
  title: titleTag,
  slug: { _type:'slug', current: slugCurrent },
  excerpt: metaDesc,
  publishedAt: new Date().toISOString(),
  author: 'Mitch',
  categories: [ref('category-bed-bugs'), ref('category-heat-treatment')],
  tags: [ref('tag-bed-bug-heat-treatment'), ref('tag-heat-treatment-prep'), ref('tag-tulsa')],
  seo: {
    seoTitle: titleTag,
    seoDescription: metaDesc
  },
  content: contentBlocks
};

const res = await client.create(doc);
console.log(JSON.stringify({ ok:true, createdId: res._id, slug: res.slug?.current, title: res.title }, null, 2));
