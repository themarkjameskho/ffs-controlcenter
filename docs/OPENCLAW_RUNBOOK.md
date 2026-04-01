# OpenClaw Runbook

This document is written for OpenClaw/Codex-style agents working inside this workspace.

Its job is to make the control center easy to maintain without a database:

- understand the current system
- update the right files
- avoid changing the wrong files
- suggest the next highest-value action

## Mission

Keep the Fast Forward Control Center aligned with the real production workflow:

`human-order -> auto distribution -> research -> write -> lint -> qc -> done`

The control center is folder-based. The filesystem is the source of truth.
Global done rule: a deliverable is Done only when a QC artifact explicitly indicates `PASS`.

## Read Order

When working on the control center, read files in this order:

1. `README.md`
2. `docs/CODEX_CONTROL_CENTER_SPEC.md`
3. `docs/QC_PASS_MIGRATION_PLAN.md`
4. `docs/ORDER_PLANNER_GUIDE.md`
5. `docs/DASHBOARD_DATA_GUIDE.md`
6. `docs/KANBAN_AI_GUIDE.md`
7. This file: `docs/OPENCLAW_RUNBOOK.md`
8. `docs/CHARLIE_DATA_REQUIREMENTS.md`

If the task involves planning:

8. `../human_orders/_inbox/`
9. `../human_orders/processed/<latest-plan-id>/summary.json` if it exists

If the task involves board accuracy:

10. `public/ff_state/orders.json`
11. `public/ff_state/week*.json`
12. `public/ff_state/live.json`

## System Model

Treat the system as 4 layers:

1. Intake layer
- Raw CSVs or human-order files in `../human_orders/_inbox/`

2. Planning layer
- Canonical plan folders in `../human_orders/processed/<plan-id>/`
- Main file: `agent-distribution.json`
- This is produced by the auto distribution script, not a planner sub-agent

3. Projection layer
- UI-ready board state in `public/ff_state/week*.json`
- UI-ready order windows in `public/ff_state/orders.json`

4. Operational movement layer
- Fast, reversible updates in `public/ff_state/live.json`

## Source Of Truth Rules

Use these rules consistently:

- Raw order intent lives in `_inbox`
- Canonical planning intent lives in `processed/<plan-id>/agent-distribution.json`
- Board projection lives in `week*.json`
- Day-to-day status movement should prefer `live.json`
- A task or deliverable is Done only when QC says `PASS`
- Deliverable completion should be validated against the real filesystem in `../deliverables/`
- Ignore non-production helper folders such as `../deliverables/_reports/`
- Treat test order buckets like `week16-16-test_1` as valid order buckets, not malformed data
- If a newer CSV appears in `_inbox`, `/api/order-registry` should refresh automatically during dev-server polling

Do not treat the UI alone as truth.

## What OpenClaw May Update

OpenClaw may safely update these files when needed:

- `public/ff_state/orders.json`
- `public/ff_state/week*.json`
- `public/ff_state/live.json`
- `docs/*.md`
- `README.md`
- `../human_orders/processed/<plan-id>/*`

OpenClaw should be careful with:

- `src/*.tsx`
- `src/*.css`
- `vite.config.ts`

OpenClaw should not change appearance or layout unless explicitly asked.
OpenClaw should not force a task to Done in `live.json` unless QC PASS truth exists on disk.

## GitHub + Vercel (OpenClaw operator / Charlie)

Primary goal: teammates can access the **login-protected** Control Center online, and code updates deploy automatically.

Authoritative step-by-step doc:
- `docs/OPENCLAW_GITHUB_VERCEL_DEPLOY.md`

### What auto-deploys vs what does not
- ✅ **Code/UI changes** auto-deploy on Vercel when you push to GitHub (usually `main`).
- ❌ **Content/dashboard data** does not “upload itself” from GitHub. If online mode is `VITE_DATA_SOURCE=sanity`, OpenClaw must sync content/task state into Sanity.

### Minimal safe checklist (code deploy)
1) Make sure you are inside the repo root:
   - This workspace repo root is `fast-forward-control-center/` (where `package.json` lives).
2) Verify you are authenticated to GitHub:
   - Preferred: SSH deploy key (read-write) for this repo.
   - Alternate: GitHub PAT (keep it secret; never paste into docs).
3) Do not commit secrets:
   - `.env.local` must remain uncommitted (it is ignored by `.gitignore`).
4) Push to `main`:
   - Vercel is already connected and will build/deploy after the push.

### Vercel sanity checks
- If env vars change, you must **redeploy** for them to take effect.
- Keep the deployment **login-protected** using Vercel’s project protection settings.

## What To Run

Use these commands:

```bash
npm run orders:build
npm run orders:plan -- --input ../human_orders/_inbox/<file>
npm run orders:plan -- --dry-run
npm run lint
npm run build
```

Use `orders:plan` when the request is about converting a human order or CSV into assigned agent work.

Use `live.json` patches when the request is about reversible movement for work already planned.

## Update Protocol

When updating the control center, follow this sequence:

1. Read the latest order input.
2. Decide whether the task is:
   - planning
   - board sync
   - operational movement
   - documentation only
3. If planning:
   - run `orders:plan -- --dry-run`
   - verify affected weeks
   - write the plan only when the result matches expected weeks and task volume
4. If board sync:
   - compare `week*.json` and `live.json` against actual deliverables
   - patch `live.json` first when possible
   - never mark Done without QC PASS evidence
5. If documentation:
   - update docs and README links together if needed
6. Run `npm run lint` and `npm run build` when code or config changes

## Suggestion Engine

When asked “what should be done next?”, use this rubric.

Always suggest the highest-priority unmet item first.

### Priority 1: Broken Truth Flow

Suggest this if:

- `_inbox` contains a new order that has not been planned
- `orders.json` does not reflect the latest intended order window
- a required `week*.json` file is missing for an active order
- a test order bucket such as `week16-16-test_1` exists but is not visible/filterable in the UI

Suggested action:

- “Run the planner for the newest input and project the affected week files.”

Note:
- if the order window is missing entirely, fix order-registry refresh first
- if the order window exists but has no cards yet, generate the week-state plan next

### Priority 2: Planning Gaps

Suggest this if:

- there is no `processed/<plan-id>/agent-distribution.json`
- agent ownership is missing on planned tasks
- a week file contains only human-order items but no downstream planned tasks

Suggested action:

- “Generate or regenerate the canonical agent distribution plan.”

### Priority 3: Operational Drift

Suggest this if:

- deliverables exist on disk but the board still shows earlier stages
- `live.json` is empty while active work is clearly moving
- task dates or owners are missing for in-flight stages
- the board shows Done but there is no QC PASS artifact
- GBP/GMB outputs exist without QC artifacts, so they can never satisfy the global Done rule

Suggested action:

- “Patch live board movement so the UI matches real production progress.”

### Priority 4: Capacity / Clarity Gaps

Suggest this if:

- one owner is overloaded while others are empty
- the plan has no explicit owner pool configuration
- week task count is much larger than expected and hard to scan

Suggested action:

- “Add or refine `../human_orders/agent-pools.json` and rebalance assignments.”

### Priority 5: Documentation Gaps

Suggest this if:

- the workflow changed but docs still describe old behavior
- a new script exists without usage documentation
- the control-center contract is split across code only

Suggested action:

- “Update the runbook and planner guide so future agents stay aligned.”

## Deterministic Checks

Before making suggestions, check these:

- Is there a newer file in `../human_orders/_inbox/` than the latest processed plan?
- Do active order weeks in `orders.json` have matching `week*.json` files?
- Do planned tasks have `owner` fields?
- Do in-flight tasks have stage dates?
- Do deliverables on disk imply later-stage completion than the board currently shows?
- Do any Done states lack QC PASS proof?
- Are GBP/GMB units missing QC artifacts?
- Are suffix week buckets like `week16-16-test_1` being parsed and surfaced correctly?
- Do the dashboards have enough inputs? (See `docs/CHARLIE_DATA_REQUIREMENTS.md`)

If the answer is yes to any of those, suggest the smallest corrective action that restores alignment.

## Safe Defaults

When data is incomplete, use these defaults:

- prefer round-robin agent assignment by stage
- prefer updating `live.json` over rewriting week files for operational changes
- prefer keeping historical files instead of deleting them
- prefer dry-run planning before write planning
- prefer documenting the contract when behavior is changing

## Definition Of Done

An update is done when all are true:

- order input is represented in `orders.json`
- affected weeks exist in `week*.json`
- agent ownership is visible where needed
- operational movement is reflected in `live.json` if applicable
- every Done state has QC PASS proof
- docs match the real behavior
- validation commands pass if code changed

## Recommended Future Improvements

If no urgent corrective action exists, OpenClaw should suggest one of these:

1. Add a distribution summary view in the UI from `processed/<plan-id>/agent-distribution.json`
2. Upgrade `/api/deliverables-index` to expose QC PASS unit truth
3. Add QC artifacts for GBP/GMB outputs so the global Done rule applies uniformly
4. Add a board-sync script that compares deliverables and auto-patches `live.json`
5. Add an “unplanned inbox” indicator when `_inbox` is newer than the last processed plan
6. Add validation warnings for missing owners, missing dates, missing week files, and missing QC

## Short Answer Format

When reporting status or suggestions, OpenClaw should keep the answer compact:

- current state
- gap detected
- next recommended action
- files or command involved

Example:

“Newest order exists in `_inbox`, but there is no processed plan for it yet. Next action: run `npm run orders:plan -- --input <file>` and review the generated week files.”

## Trigger Phrases

If the user uses the trigger phrase `check tasks` (or `check task`), interpret it as:

1) **Event-driven QC sweep (no cron):**
   - For any post folder containing `.ff/writer_done.json` and missing `.ff/qc_done.json`, run QC for that post and write the QC report + `.ff/qc_done.json`.
   - QC marker contract: see `docs/pipeline_markers.md`.

2) **Control Center state update:**
   - Run the state sync/update logic once after processing QC so the UI reflects the latest artifacts.

3) **Report (short):**
   - Summarize what changed (counts: QC run / PASS / FAIL / skipped) and any blockers.
   - Add 1–3 concrete recommendations only if there are real issues.

Implementation entrypoints:
- CLI: `npm run check:tasks`
- Dev server: `POST /api/check-tasks`
- Chat bridge: `POST /api/chat` with message text `check tasks` (appends an `OpenClaw` summary message)

## Notes To OpenClaw/Charlie (Status + Recommendations)

### 2026-03-17

Task: Implemented `check tasks` trigger behavior per `docs/pipeline_markers.md`:
- QC sweep: scan `deliverables/**/post_*/` for `.ff/writer_done.json` without `.ff/qc_done.json`, then generate `*_qc_v1.md` + write `.ff/qc_done.json`.
- Single update run after sweep: runs `orders:build` once.
- Summary output: `qc_run_count`, `pass_count`, `fail_count`, `skipped_count` + blockers.

Recommendations:
- Consider adding a stable idempotency key (example: `content_hash` or `writer_done_id`) to `.ff/writer_done.json` so QC can skip re-runs deterministically even if file timestamps change.
- Consider allowing richer `qc_done.json` metadata (example: `qc_status: fail` already exists; optionally add `fail_reasons` or `qc_version`) to support UI summaries without parsing the full QC markdown.
- Prefer atomic writes for marker files (write temp + rename) so watchers never see partial JSON.
