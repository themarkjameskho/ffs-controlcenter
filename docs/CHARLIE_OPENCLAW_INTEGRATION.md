# Charlie/OpenClaw → Control Center Integration (Online + Sanity)

This doc is for Charlie/OpenClaw (the production runner) so the Fast Forward Control Center stays accurate, useful, and accessible to the team online.

## Goal

Make the Control Center **login-protected + online** (Vercel) while staying **data-driven**:
- dashboards show real progress (not guesses)
- teammates can preview/download markdown artifacts
- updates happen automatically when production creates or QC’s content

## Where we are right now (static Vercel snapshot)

The repo currently supports a **static snapshot** deployment:
- UI is hosted on Vercel (Vite `dist/`)
- artifacts are served as static files under `public/ff_artifacts/**`
- deliverables index is served as `public/ff_state/deliverables-index.json`

Update mechanism today:
1. Run `npm run snapshot:build`
2. Commit + push snapshot files
3. Vercel redeploys from Git

Doc: `docs/VERCEL_DEPLOYMENT.md`

This works, but it is **not automatic**—it requires a commit.

## Target: Sanity as the online source of truth

We’re moving toward a Sanity-backed model so updates flow automatically:

**Charlie/OpenClaw writes to Sanity** (orders, tasks, artifacts, QC results) → **Control Center reads from Sanity** via Vercel-hosted API routes.

This removes the “snapshot + commit” step and keeps the online dashboard fresh.

## Content format (so SPC can preview + download)

Charlie creates artifacts as Markdown files today. For SPCs to preview and download content from the online Control Center, we should store content in Sanity in a way that supports:
- accurate preview (headings, lists, links)
- clean Markdown download (exactly what Charlie authored)

### Recommended: store both `rawMarkdown` and `body` (Portable Text)

Store each artifact with two representations:

1) `rawMarkdown` (string)
- Source-of-truth for download.
- Exactly the markdown Charlie produced (no transformations).

2) `body` (Portable Text / block content)
- Used for the on-screen preview in the web UI.
- Keeps headings (h2/h3/…), lists, and links as structured data.

Charlie does **not** need to “write Portable Text”. The sync step should:
- read the markdown file from disk
- convert markdown → Portable Text
- upsert both fields into Sanity (idempotently)

### Heading rules (H tags)

To keep preview/navigation consistent across content types:
- Use this convention (locked):
  - **A)** `title` is stored as a Sanity field, and the first heading in markdown starts at `##` (markdown body starts at H2).
- Don’t skip levels (avoid `##` → `####`).

### Link rules (Sanity-friendly)

Markdown links should be standard:
- `[Anchor text](https://example.com/page)`

Avoid:
- bare URLs with no anchor text
- filesystem-relative links that won’t work online

Conversion target (Portable Text):
- represent links as marks with `markDefs` (type `link`) containing at least `href`.

### Schema implication (what we’ll build)

For each `artifact` doc, plan on:
- `title` (string)
- `rawMarkdown` (text)
- `body` (array of Portable Text blocks)
- `links` (optional derived list for reporting/audits)
- plus existing metadata fields (client/week/type/workflow/modifiedAt/etc.)

### What teammates need (scope)

Online Control Center must support:
- read dashboards (Dashboard / Kanban / Calendar / Client views)
- preview markdown/text artifacts
- download markdown/text artifacts

Online Control Center does **not** need:
- local `locate-file`
- CSV upload into local inbox
- direct filesystem scanning

## Charlie’s responsibilities (what to publish)

Charlie should publish four categories of data to Sanity.

### 1) Clients

Minimum fields:
- `client.slug` (matches folder slug and task `client_slug`)
- `client.name`

### 2) Order windows (planned targets)

Minimum fields:
- `orderWindow.id` (deterministic; example `order-2026-11-15`)
- `year`, `startWeek`, `endWeek`, `label`
- `plannedTotal`
- `plannedByClient` (map)
- `plannedByType` (map)
- `source` (where the plan came from; file name or identifier)
- `generatedAt`

### 3) Tasks (workflow projection)

Minimum fields (mirrors `public/ff_state/week*.json` Task shape):
- `task.id` (stable + deterministic)
- `client_slug`
- `week`
- `stage` (`human-order|planner|researcher|writer|qc|publisher`)
- optional: `owner`, `status`, `priority`
- optional dates (YYYY-MM-DD): `research_date`, `writer_date`, `qc_date`, `publish_date`
- optional linking: `parent_id`
- optional planning totals for `plan_artifact`: `deliverables` map

**Important**
- Task IDs must remain stable across reruns (idempotent upserts).
- If a task is “Done”, it still must not contradict QC truth (see QC section).

### 4) Artifacts + QC truth (completion)

Artifacts are the only thing teammates must be able to *read/download* online.

Minimum fields:
- `artifact.id` (deterministic; recommended: hash of `relativePath` or of `{weekBucket, clientSlug, type, unitKey, filename}`)
- `clientSlug`
- `weekBucket` (example `week11-15` or `week16-16-test_1`)
- `artifactType` (example `blog_post`, `gbp_post`, `link_1`)
- `workflow` (`draft|qc|research|other`)
- `contentCategory` (`blog|gmb|l1|l2|l3|qc|research|other`)
- `modifiedAt` (ISO string)
- `relativePath` (the canonical path representation we show in UI)
- `rawMarkdown` (text; exact markdown for download)
- `body` (Portable Text; derived from markdown for preview)

QC truth must be explicit:
- `qcResult.hardGate` = `PASS|FAIL`
- `qcResult.checkedAt`
- link QC result to its deliverable unit (same unit key used for counting)

## Event timing (when to upsert)

Charlie should upsert to Sanity on these transitions:

1. **Order intake / plan refresh**
   - after a new order CSV/human-order is accepted
   - after the distribution/plan script runs

2. **Artifact creation**
   - when a draft markdown is written
   - when a QC markdown is written

3. **QC decision**
   - when QC produces PASS/FAIL (this is the global Done gate)

4. **Stage movement**
   - when a task moves stage due to real work completion

## Deterministic IDs (required for smooth integration)

Charlie must generate IDs consistently so the UI doesn’t duplicate rows.

Recommended rules:
- `task.id`: keep existing `week*.json` IDs if they already exist; otherwise derive from `{year, week, client_slug, type, unitKey}`
- `artifact.id`: derive from the stable artifact path (not from timestamps)
- `unitKey`: `{weekBucket}|{clientSlug}|{artifactType}|{unitFolder}` (ignore helper packs like `pack_*`)

## Security + access

Online dashboard is Vercel login-protected (team members only).

Charlie should use a Sanity API token:
- stored in environment variables (never committed)
- minimal permissions (write only to the needed dataset)

## Open questions (need answers before implementation)

1) Confirm whether we ever need a file asset in addition to `rawMarkdown` (only if artifacts get too large for a text field).

2) How large can artifacts get (max file size), and do we need partial loading?

3) Dataset naming + environments:
   - `prod` vs `staging`
   - whether the Control Center should read staging by default on preview deployments

## What Charlie should do next

1. Confirm artifact storage mode (text vs file asset).
2. Provide:
   - `SANITY_PROJECT_ID`
   - `SANITY_DATASET`
   - required auth approach (token / SSO constraints)
3. Identify the exact pipeline moments where Charlie can run a “sync to Sanity” step.
