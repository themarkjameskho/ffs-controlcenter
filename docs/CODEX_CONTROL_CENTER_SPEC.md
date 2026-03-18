# Codex Spec — Fast Forward Control Center (Data-Driven, QC-PASS Done)

This document defines what Codex should assume when implementing/updating the Fast Forward Control Center.

## Core Contract

**Filesystem is the source of truth.**

Workflow:
`Human Order (CSV) → (auto distribution script) → Research → Write → Lint → QC (PASS/FAIL) → Done`

**Definition of Done (global):**
A deliverable is **Done only when it has a QC report with status = PASS**.

No deliverable type is exempt (blogs, GBP/GMB posts, link articles). If there is no QC PASS artifact, it is not Done.

## Order Inputs

CSV inbox:
- `/Users/coryrisseeuw/.openclaw/workspace/human_orders/_inbox/`

CSV schema:
- `client,start_week,end_week,content_type,quantity`

Order Registry API (UI selection + totals):
- `GET /api/order-registry`

Registry rules:
- All CSVs in `_inbox` are scanned.
- Duplicate week windows: newest file wins.
- Orders are grouped by `(year, start_week, end_week)`.

Planned totals (per order):
- `plannedTotal = sum(quantity)`
- `plannedByClient`, `plannedByType` computed similarly.

## Deliverables Index (progress numerator)

Deliverables scan API:
- `GET /api/deliverables-index`

Folder scanned:
- `/Users/coryrisseeuw/.openclaw/workspace/deliverables`

**Counting unit:** one *deliverable unit* counts once.
Recommended unit key:
- `{weekBucket}/{client_slug}/{content_type}/{unit_folder}`
  - blog: `.../blog_post/post_XX/`
  - gbp: `.../gbp_post/post_XX/`
  - links: `.../link_*/article_XX/`

**Done rule (critical):**
- A unit is Done **only if** a QC file exists AND indicates `PASS`.

QC file patterns (canonical):
- blog_post: `*_qc_v1.md`
- gbp_post: `*_qc.md` (add if missing today)
- link_1/link_2/link_3: `*_qc.md`

QC parsing rule:
- Look for `Hard Gate Result: PASS|FAIL` (case-insensitive) or equivalent explicit status.

**Exclude:** research packs (`research/pack_*`) never count as Done units.

## Dashboard Metrics (must match code)

Dashboard implementation:
- `fast-forward-control-center/src/pages/Dashboard.tsx`

### Expected % (timeline)
- Convert selected order weeks to date range; compute:
- `expectedPct = elapsedDays / totalDays * 100`

### Actual % (progress)
Per client:
- deliverablePct = `qcPassUnits / plannedDeliverables`
- taskPct = `completedTasks / generatedTasks` (if tasks are modeled)
- actualPct = average of available pct parts

**Important:** deliverablePct must use QC PASS units, not draft existence.

### Risk Labels
Per client:
- `at_risk` if overdueCount > 0 OR WIP > threshold
- `watch` if actualPct + 5 < expectedPct
- else `on_track`

## Kanban Model (Assigned-driven)

Kanban should group cards by **Assigned** (not owner role lanes).

Source fields:
- `task.owner` (or `task.assigned` if renamed) is the grouping key.

Definition of Done for Kanban:
- A card is Done when the underlying deliverable unit has QC PASS.

Avoid manual drift:
- Prefer generating/updating board state from filesystem + QC outcomes.
- `public/ff_state/live.json` may be used only for reversible operational movement, not to override QC truth.

## Queue Runner / Dispatcher

The "distribution script" already exists and produces recommended task assignments.
HMSTR (main agent) is manually activated to run production and may:
- validate the distribution
- correct assignments if needed
- run the queue runner continuously (no idle pauses)

Planner sub-agent is deprecated/removed.

## How the Control Center updates during production

The Control Center must update **data-driven** from artifacts + QC outcomes.

There are two independent update streams:

1) **Progress / dashboard counts (deliverables-index):**
- `GET /api/deliverables-index` scans `/deliverables` on an interval.
- A deliverable unit counts as Done only when its QC report indicates PASS.

2) **Board/task movement (week*.json + live.json):**
- `week*.json` holds the planned tasks and their `owner/assigned` values.
- A lightweight "hydrator" (cron or post-job hook) should read the deliverables folder and QC PASS files, then patch `public/ff_state/live.json` so tasks automatically move to Done when QC passes.
- Humans should not need to drag cards to keep the board truthful.

## Codex implementation requests (open)

1) **Dashboard progress must use QC PASS, not draft existence**
- Update `/api/deliverables-index` and/or Dashboard aggregation so done units only count when a QC artifact exists and indicates PASS.

2) **Add QC for GBP/GMB posts**
- Ensure each GBP output has a QC artifact (PASS/FAIL) so the global Done rule applies.

3) **Tests must be filterable as orders**
- Support week-bucket suffixes like `week16-16-test_1` (week parsing + display).

4) **Kanban grouping by Assigned**
- Columns should reflect `task.owner` / `task.assigned` (Assigned), with Done driven by QC PASS truth.

5) **Hydrator**
- Implement a lightweight folder→`live.json` hydrator (cron or post-job hook) to move tasks to Done automatically when QC PASS appears.

## Required Outcome

After implementation:
- Week11–15 and future orders must reflect true completion.
- Dashboard/Kanban numbers must align with QC PASS artifacts on disk.
- Any content without QC PASS must not be shown as Done.
