# QC PASS Migration Plan

This document explains how to move the control center from the current legacy UI behavior to the intended data-driven model.

Target model:

- completion truth comes from QC PASS artifacts on disk
- Kanban groups by assigned owner
- `live.json` supports reversible movement only
- the UI must not infer Done from stage alone

## Current Gaps

These are the main places where the current app still behaves like the legacy model.

### 1. Dashboard counts drafts and other content artifacts as completed

Current hotspot:
- `src/pages/Dashboard.tsx`

Current behavior:
- `contentUnits` are built from any artifact in categories `blog`, `gmb`, `l1`, `l2`, `l3`
- completion is based on the latest artifact in the unit, not QC PASS proof

Why this is wrong:
- a draft existing on disk must not count as Done
- a unit is Done only when its QC artifact indicates `PASS`

### 2. Task completion logic is stage/status based, not QC truth based

Current hotspot:
- `src/pages/Dashboard.tsx`
- function `isCompletedTask`

Current behavior:
- returns true when status contains `done|complete|publish|closed`
- returns true when stage is `publisher` and publish date is in the past
- returns true for every `publish_bundle`

Why this is wrong:
- none of those guarantee QC PASS
- this can overstate progress and hide incomplete work

### 3. Kanban is lane-driven instead of assigned-driven

Current hotspot:
- `src/pages/Kanban.tsx`

Current behavior:
- cards are grouped into 4 fixed lanes: Inbox, Work In Progress, Approval, Done
- lane placement comes from `stage`

Why this is wrong:
- the spec says Kanban should group by `Assigned` / `task.owner`
- the current model makes ownership secondary instead of primary

### 4. Kanban “Ready / Published” summary uses publisher stage count

Current hotspot:
- `src/pages/Kanban.tsx`

Current behavior:
- “Ready / Published” is `totals.byStage.publisher`

Why this is wrong:
- publisher stage is not the same as QC PASS
- a task can be in publisher without true Done proof

### 5. Deliverables index does not expose QC PASS unit truth

Current hotspot:
- `vite.config.ts`
- `/api/deliverables-index`

Current behavior:
- scans artifacts and classifies them by workflow/category
- does not build an explicit `unit -> qc pass status` model

Why this matters:
- both Dashboard and future Kanban hydration need a deterministic QC PASS answer per deliverable unit

### 6. GBP/GMB outputs are not yet fully inside the QC PASS contract

Current hotspot:
- deliverables folder conventions
- `/api/deliverables-index`

Current behavior:
- blog and link outputs have clearer QC expectations today
- GBP/GMB outputs may exist without matching QC artifacts

Why this is wrong:
- the global done rule says no deliverable type is exempt
- GBP/GMB content must also have PASS/FAIL QC artifacts

### 7. Test order buckets must behave like real orders

Current hotspot:
- week bucket parsing in `vite.config.ts`
- order filtering in Dashboard/Kanban

Current behavior:
- test suffixes like `week16-16-test_1` are now documented
- UI and aggregation code still need to consistently honor them

Why this matters:
- tests are part of the operating workflow
- if test buckets are ignored or collapsed incorrectly, order filtering and progress drift

### 8. New inbox CSVs must surface without manual rebuild friction

Current hotspot:
- `/api/order-registry`
- snapshot handling in `vite.config.ts`

Current behavior target:
- if `_inbox` contains a newer CSV than `public/ff_state/orders.json`, the dev server should refresh the registry automatically

Why this matters:
- humans expect a new order to show up in the UI after dropping it into the inbox
- manual rebuild steps make the control center feel stale and confusing

## Safest Fix Order

Implement the migration in this order.

### Phase 1: Fix the deliverables truth model

Goal:
- make the backend expose per-unit QC PASS truth

Required work:

1. Build a deliverable-unit map in `/api/deliverables-index`
- Unit key:
  - `{weekBucket}/{client_slug}/{content_type}/{unit_folder}`

2. Scan QC files for each unit
- canonical patterns:
  - `*_qc_v1.md`
  - `*_qc.md`

Include all deliverable families:
- blog posts
- GBP/GMB posts
- link articles

3. Parse PASS/FAIL explicitly
- look for:
  - `Hard Gate Result: PASS`
  - `Hard Gate Result: FAIL`
  - or equivalent explicit final status

4. Return unit-level fields such as:
- `unitKey`
- `hasQc`
- `qcStatus`
- `qcPassed`
- `latestQcAt`
- `latestDraftAt`

Definition of done for this phase:
- backend can answer “is this unit QC PASS complete?” without UI guesswork
- backend ignores helper folders like `deliverables/_reports/`
- backend accepts suffix week buckets like `week16-16-test_1`

### Phase 2: Make Dashboard use QC PASS only

Goal:
- stop overcounting draft existence as completion

Required work:

1. Replace `contentUnits` logic in `src/pages/Dashboard.tsx`
- use only units with `qcPassed === true`

2. Update `doneTodayCount`
- count units whose latest QC PASS timestamp is today

3. Update client progress rows
- `completedDeliverables` must be QC PASS units only

4. Replace task completion heuristics where they affect actual progress
- remove assumptions like:
  - publisher stage means done
  - publish date in the past means done
  - publish bundle means done

Definition of done for this phase:
- Dashboard progress matches QC PASS truth on disk
- test orders remain filterable like normal orders

### Phase 3: Add a board hydrator

Goal:
- let the board automatically reflect filesystem truth

Required work:

1. Create a hydrator script
- reads `week*.json`
- reads deliverables/QC PASS unit truth
- writes reversible patches to `public/ff_state/live.json`

2. Hydrator behavior
- move tasks forward only when supporting artifacts exist
- move tasks to Done only when QC PASS exists

3. Preserve safety
- do not rewrite history unnecessarily
- do not fake completion from stage alone

Recommended outcome:
- humans do not need to drag cards to keep the board honest
- GBP/GMB units become automatically eligible for Done once QC PASS exists

### Phase 4: Move Kanban from lanes to assigned groups

Goal:
- make ownership the main board structure

Required work:

1. Replace lane grouping in `src/pages/Kanban.tsx`
- group by `task.owner`
- keep an `Unassigned` group

2. Within each owner group, segment by status
- suggested buckets:
  - queued
  - active
  - approval
  - done

3. Keep stage visible on each card
- stage should remain metadata, not the primary grouping axis

4. Recompute summary stats from QC PASS truth
- “Done” should reflect QC PASS-complete units/tasks only

Definition of done for this phase:
- Kanban answers “who owns what?” first, not “which lane is this in?”

## Recommended Data Additions

These additions will make the migration easier and more deterministic.

### Add `deliverable_key` to the shared task type

Current concern:
- planner-generated tasks already carry a deliverable unit concept, but the shared TS type does not formally model it

Recommendation:
- add `deliverable_key?: string` to `src/lib/types.ts`

Why:
- lets the hydrator map filesystem units back to tasks safely

### Add explicit QC summary fields to deliverables API types

Current concern:
- frontend types do not model QC PASS unit truth

Recommendation:
- extend deliverables types with unit-level QC fields

Why:
- avoids hidden parsing logic in multiple UI components

### Keep week bucket parsing tolerant but deterministic

Current concern:
- production and test orders may share the same week range with different suffixes

Recommendation:
- parse buckets by `week<start>-<end>` prefix
- preserve the full bucket label for display/filtering

Why:
- this allows tests-as-orders without breaking date math

## Main Concerns

OpenClaw should keep these concerns in mind while implementing.

### Concern 1: False Done states

This is the biggest risk.

If any UI code still treats `publisher`, `publish_date`, or `publish_bundle` as automatically done, progress will drift from reality.

### Concern 2: Mixed unit definitions

All counting must use the same unit key shape.

If Dashboard, hydrator, and planner use different keys, the board will be unstable.

### Concern 3: Legacy drag-and-drop expectations

The current Kanban supports drag-and-drop by lane.

When moving to assigned-driven grouping, do not preserve old lane logic by accident. Decide whether drag means:

- reassign owner
- change stage
- or both

That behavior must be explicit.

### Concern 4: `live.json` overriding truth

`live.json` is useful for reversible movement, but it must never contradict QC PASS evidence on disk.

Filesystem truth wins.

### Concern 5: GBP/GMB never reaching Done

If GBP/GMB outputs do not get QC artifacts, they will permanently sit outside the global Done rule.

That creates a fake partial-completion system.

### Concern 6: Test orders disappearing from filters

If suffix week buckets are normalized too aggressively, test runs may vanish from order selection or be merged into production windows.

That makes validation harder and hides real workflow state.

## Suggested Next Implementation Step

If only one change is made next, do this first:

1. upgrade `/api/deliverables-index` to emit QC PASS unit truth
2. switch Dashboard completion math to use that truth

Immediately after that:

3. ensure GBP/GMB QC artifacts are supported in the same truth model
4. ensure suffix week buckets remain visible as test orders

This gives immediate value with low UI disruption and creates the correct backend contract for Kanban migration later.

## Short Guidance For OpenClaw

When asked what to do next on this migration, answer like this:

- current gap
- affected file
- smallest safe fix
- why it should happen before later phases

Example:

“Dashboard still counts any latest content artifact as completed. Update `/api/deliverables-index` and `src/pages/Dashboard.tsx` so only QC PASS units increase done progress. This should happen before Kanban regrouping because it establishes the correct completion contract.”
