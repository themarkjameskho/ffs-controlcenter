# Data Requirements From Charlie (OpenClaw) → Control Center

This Control Center is file-based. If the dashboards feel “empty” or “not useful”, it’s almost always because one of the required filesystem inputs is missing, stale, or shaped differently than the UI expects.

This doc defines the minimum data Charlie/OpenClaw should produce (or keep updated) so the Control Center can show meaningful signal.

If the goal is an **online, auto-updating** dashboard, see `docs/CHARLIE_OPENCLAW_INTEGRATION.md` (Sanity-backed target).

## 1) Order Intake (planned targets)

**Required folder**
- `/Users/coryrisseeuw/.openclaw/workspace/human_orders/_inbox/`

**Required file type**
- One or more `.csv` files. Newest file wins when multiple CSVs describe the same week range.

**Required CSV columns**
- `client,start_week,end_week,content_type,quantity`

**Notes**
- `client` must match the deliverables folder slug (example: `heat_tech_bed_bug`).
- `content_type` should be the production types used in planning (examples: `blog_post`, `gpp_post`, `gbp_post`, `link_1`, `link_2`, `link_3`).

**Why this matters**
- Drives the order selector + planned totals via `GET /api/order-registry` (and the snapshot at `public/ff_state/orders.json`).

## 2) Week State Files (tasks, stage movement, due dates)

**Required folder**
- `/Users/coryrisseeuw/.openclaw/workspace/fast-forward-control-center/public/ff_state/`

**Required files**
- `week<NN>.json` for every week number referenced by the active order windows.
  - Example: if `orders.json` includes `Week 11-15`, the Control Center expects `week11.json`, `week12.json`, `week13.json`, `week14.json`, `week15.json`.

**Preferred schema (current UI contract)**
- Top-level `tasks: Task[]` array with at least:
  - `id` (string)
  - `client_slug` (string)
  - `stage` (one of `human-order|planner|researcher|writer|qc|publisher`)
  - optional dates (`research_date`, `writer_date`, `qc_date`, `publish_date`) as `YYYY-MM-DD`
  - optional `owner` for assignment visibility

**Legacy schema support**
- Some older week files group tasks under `clients[slug].tasks[]`. The Control Center now flattens this at load time, but Charlie should prefer the top-level `tasks` schema going forward to avoid tooling drift.

**Why this matters**
- Drives: Kanban, Calendar, stage radar, overdue/stuck detection, WIP counts, “Production: Live/Idle”, and per-client risk.

## 3) Live Patch File (fast, reversible status updates)

**File**
- `/Users/coryrisseeuw/.openclaw/workspace/fast-forward-control-center/public/ff_state/live.json`

**Shape**
- `{ updatedAt, tasks: [{ id, stage?, owner?, eta?, research_date?, writer_date?, qc_date?, publish_date?, parent_id? }] }`

**Why this matters**
- Lets Charlie/OpenClaw keep the UI aligned with reality without rewriting historical week files.

## 4) Deliverables Folder (what was actually produced)

**Required folder**
- `/Users/coryrisseeuw/.openclaw/workspace/deliverables/`

**Expected structure (recommended)**
- `deliverables/week<start>-<end>[-suffix]/<client_slug>/<artifact_type>/<unit_folder>/<files…>`
  - Examples:
    - `deliverables/week11-15/heat_tech_bed_bug/blog_post/post_01/...`
    - `deliverables/week11-15/heat_tech_bed_bug/link_3/article_01/...`
    - `deliverables/week11-15/heat_tech_bed_bug/gbp_post/post_01/...`

**Why this matters**
- Drives: Recent Artifact Activity feed, Client dashboards, and all “written output” counts.

## 5) QC Artifacts (the global Done rule)

**Global Done rule**
- A deliverable is Done only when a QC artifact exists and explicitly indicates `PASS`.

**What Charlie must ensure**
- Every deliverable *unit* (blog, GBP/GMB post, link article) must have a QC file.
  - Blog: `*_qc_v1.md` and/or `*_qc.md`
  - Links: `*_qc.md`
  - GBP/GMB: `*_qc.md` (add if missing)
- QC content must include an explicit PASS/FAIL marker the system can parse.
  - Recommended: a line like `Hard Gate Result: PASS` (case-insensitive).

**Why this matters**
- Without QC PASS artifacts, the Control Center cannot truthfully show completion.

## 6) Client Catalog (names + slugs)

**File**
- `/Users/coryrisseeuw/.openclaw/workspace/fast-forward-control-center/public/ff_state/clients.json`

**Required**
- Must list every `client_slug` that will appear in:
  - inbox CSVs
  - week state files
  - deliverables folder paths

**Why this matters**
- Improves readability and prevents “missing client” views when new slugs appear.

## 7) Quality + speed signals (recommended for a comprehensive dashboard)

The Control Center can score content quality automatically (SEO + readability) from Markdown, but **speed / revisions** requires explicit timestamps/logs.

### 7.1 Required for cycle-time (writer → QC) accuracy
Per post folder, write these markers under `post_<NN>/.ff/`:
- `.ff/writer_done.json` (writer completion timestamp)
- `.ff/qc_done.json` (QC completion timestamp + pass/fail)

These are already defined in `docs/pipeline_markers.md`.

### 7.2 Recommended for publishing readiness (draft vs ready vs published)
Also under `post_<NN>/.ff/`:
- `.ff/publish_status.json` (new; publisher agent writes)
- `.ff/image_status.json` (new; image consolidation agent writes)

### 7.3 Recommended for revision tracking (counts + reasons)
Also under `post_<NN>/.ff/`:
- `.ff/revision_log.json` (new; append-only)

This is the simplest way to let the dashboard show “revisions per post” and “what changed”.

## “Minimum Viable Data” checklist

If Charlie only provides the minimum, the Control Center can still be useful:

1. At least one CSV in `_inbox/`
2. `orders.json` snapshot is current (or dev server can refresh it)
3. Week files exist for the selected order weeks
4. Deliverables exist on disk for those weeks
5. QC PASS artifacts exist for at least some units
