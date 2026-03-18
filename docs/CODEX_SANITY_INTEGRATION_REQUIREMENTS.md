# Codex Requirements — Smooth Sanity Integration (Control Center Online)

Audience: Codex (implementation agent) + Charlie/OpenClaw (producer).
Goal: Put the Control Center online (login protected) while keeping production errors near-zero.

## Non-negotiables
- Do NOT break the existing local workflow (filesystem `deliverables/` + `public/ff_state/week*.json`).
- QC “DONE” truth must be explicit and must not be inferred:
  - `qcResult.hardGate = PASS|FAIL`
- Idempotency: reruns must not duplicate tasks/artifacts.

---

## 1) Sanity configuration required (inputs)
Codex needs these values (do not commit tokens):
- `SANITY_PROJECT_ID`
- `SANITY_DATASET` (recommend `staging` + `prod`)
- `SANITY_API_VERSION`
- `SANITY_WRITE_TOKEN` (Charlie/OpenClaw sync)
- `SANITY_READ_TOKEN` (Vercel API routes; can be omitted if dataset is public but not recommended)

Deployment environments:
- Vercel Preview deployments should default to `staging`.
- Vercel Production should read from `prod`.

---

## 2) Storage format decision (recommended)
Store BOTH representations per artifact:
1) `rawMarkdown` (string)
- Exact markdown produced by Charlie.
- Source-of-truth for download/export.

2) `body` (Portable Text)
- Derived from markdown for preview rendering.
- Charlie does NOT author Portable Text directly; sync step converts markdown → Portable Text.

Rationale: preview is structured; download is exact.

### 2.1 Markdown conventions (headings + links)
To keep SPC preview consistent, the sync should enforce (or at least validate) these conventions when converting:
- **Headings (locked):** **A)** Sanity `title` is authoritative; markdown body headings start at `##` (H2).
- **No skipped levels:** avoid `##` → `####`.
- **Links:** require standard markdown links (`[text](https://...)`), and convert to Portable Text marks (`markDefs` type `link` with `href`).

---

## 3) Deterministic IDs (required)
### 3.1 Tasks
- Keep the current `task.id` values from `public/ff_state/week*.json`.
- Upserts must key on `task.id` (no duplicates).

### 3.2 Artifacts
- `artifact.id` must be derived from stable identity, NOT timestamps.
- Recommended: hash of `relativePath`.

### 3.3 Unit key
- `unitKey = {weekBucket}|{clientSlug}|{artifactType}|{unitFolder}`
- Ignore helper folders like `pack_*`.

---

## 4) Sanity data model (minimum viable)

### 4.1 client
- `slug` (string)
- `name` (string)

### 4.2 orderWindow
- `id` (deterministic, e.g. `order-2026-16-16-test_2`)
- `year`, `startWeek`, `endWeek`, `label`
- `plannedTotal` (number)
- `plannedByClient` (object/map)
- `plannedByType` (object/map)
- `source` (string)
- `generatedAt` (datetime)

### 4.3 task
Mirror `week*.json` task shape:
- `id` (string, deterministic)
- `client_slug` (string)
- `week` (number)
- `stage` (enum: human-order|planner|researcher|writer|qc|publisher)
- `type` (string)
- `content_type` (string, optional)
- `deliverable_key` (string, optional)
- `owner`, `status`, `priority` (optional)
- dates: `research_date`, `writer_date`, `qc_date`, `publish_date` (optional)
- `parent_id` (optional)
- `artifact_path` (optional; online should use artifact references instead)
- For plan_artifact: `deliverables` map

### 4.4 artifact
- `id` (string)
- `clientSlug` (string)
- `weekBucket` (string)
- `artifactType` (string: blog_post|gbp_post|link_1|link_2|link_3|qc|research)
- `workflow` (string: draft|qc|research|other)
- `contentCategory` (string: blog|gmb|l1|l2|l3|qc|research|other)
- `relativePath` (string)
- `modifiedAt` (datetime)
- `rawMarkdown` (text)
- `body` (Portable Text)
- `title` (string)
- `qcResult` (object, optional)
  - `hardGate` (PASS|FAIL)
  - `checkedAt` (datetime)
  - `sourceArtifactId` (string)

---

## 5) Control Center integration (minimal change)

### Phase 1: Backward compatible
- Keep existing local JSON + filesystem behavior.
- Add Sanity read APIs, but UI falls back to local if Sanity data is missing.

### Phase 2: Sanity-first online mode
- Vercel-hosted app reads from Sanity (via API routes).
- Remove/disable local-only features online:
  - locate-file
  - local CSV import
  - filesystem scanning

---

## 6) Sync triggers (Charlie/OpenClaw responsibilities)
Charlie should upsert to Sanity on:
1) After a new order is planned (`orders:plan`)
2) When a draft markdown is written
3) When a QC markdown is written
4) When QC PASS/FAIL is decided

Upserts must be idempotent.

---

## 7) Acceptance criteria (near-zero errors)
- No duplicate tasks/artifacts after reruns.
- QC PASS is the only “done” signal.
- Online preview matches local markdown meaningfully (headings/lists/links intact).
- Download returns exact `rawMarkdown` produced by Charlie.

---

## 8) Open questions (must be answered before coding)
- Confirm dataset/env names (`staging`, `prod`).
- Confirm auth approach (tokens + scopes).
- Confirm max expected artifact size (to ensure `rawMarkdown` text field is safe).
