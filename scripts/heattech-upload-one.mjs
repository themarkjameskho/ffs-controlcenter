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

const sourceId = process.env.HEATTECH_SOURCE_BLOG_ID || '1881a288-2407-45c0-a05e-cbf979c73ca9';
const mdPath = process.env.HEATTECH_MD_PATH || '../deliverables/week16-16-test_1/heat_tech_bed_bug/blog_post/post_01/2026-03-12_heat-tech_test4_blog-post_01_draft.md';

const md = fs.readFileSync(new URL(mdPath, import.meta.url), 'utf8');

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
const slug = getSection('url_slug');
const bodyMd = getSection('body_content');
const excerpt = metaDesc;

function mkKey(){return crypto.randomBytes(6).toString('hex');}

function paragraphToBlock(text){
  return {
    _key: mkKey(),
    _type: 'block',
    style: 'normal',
    markDefs: [],
    children: [{ _key: mkKey(), _type:'span', marks:[], text }]
  };
}

function headingToBlock(style, text){
  return {
    _key: mkKey(),
    _type: 'block',
    style,
    markDefs: [],
    children: [{ _key: mkKey(), _type:'span', marks:[], text }]
  };
}

function mdToPortableText(mdText){
  const lines = mdText.split(/\r?\n/);
  const blocks=[];
  let para=[];
  const flush=()=>{
    const t=para.join(' ').replace(/\s+/g,' ').trim();
    if(t) blocks.push(paragraphToBlock(t));
    para=[];
  };
  for(const line of lines){
    const l=line.trim();
    if(!l){ flush(); continue; }
    if(l.startsWith('# ')){ flush(); blocks.push(headingToBlock('h1', l.slice(2).trim())); continue; }
    if(l.startsWith('## ')){ flush(); blocks.push(headingToBlock('h2', l.slice(3).trim())); continue; }
    if(l.startsWith('### ')){ flush(); blocks.push(headingToBlock('h3', l.slice(4).trim())); continue; }
    if(l.startsWith('- ')){
      flush();
      // simple bullet list item as block
      blocks.push({
        _key: mkKey(),
        _type:'block',
        style:'normal',
        listItem:'bullet',
        level:1,
        markDefs:[],
        children:[{_key:mkKey(),_type:'span',marks:[],text:l.slice(2).trim()}]
      });
      continue;
    }
    para.push(l);
  }
  flush();
  return blocks;
}

const source = await client.getDocument(sourceId);
if (!source) throw new Error('Source blog doc not found');

const newId = 'drafts.' + crypto.randomUUID();
const payload = {
  ...source,
  _id: newId,
  _rev: undefined,
  _createdAt: undefined,
  _updatedAt: undefined,
  title: titleTag || source.title,
  slug: { _type:'slug', current: slug || (source.slug?.current ? source.slug.current + '-copy' : 'draft') },
  excerpt,
  seo: {
    ...(source.seo||{}),
    seoTitle: titleTag || source.seo?.seoTitle,
    seoDescription: metaDesc || source.seo?.seoDescription,
  },
  content: mdToPortableText(bodyMd)
};
// remove undefined keys
for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

const res = await client.createOrReplace(payload);
console.log(JSON.stringify({ ok:true, createdId: res._id, slug: res.slug, title: res.title, type: res._type }, null, 2));
