# Dashboard Data Guide (AI/Sub-Agent)

This guide defines what drives Dashboard numbers and how AI/sub-agents should move work.

If the dashboard looks empty or “not useful”, start with `docs/CHARLIE_DATA_REQUIREMENTS.md` to confirm the required inputs exist.

## Source of truth

1. Order plan (target)
- Folder: `/Users/coryrisseeuw/.openclaw/workspace/human_orders/_inbox/`
- Endpoint: `/api/order-registry`
- Rule: all CSV files are scanned; for duplicate week ranges, newest file wins.
- Grouping: rows are grouped into an order entry by `start_week-end_week` (example: `Week 11-15`).
- Totals:
- `plannedTotal = sum(quantity)` for the order
- `plannedByClient` and `plannedByType` are also computed

2. Written output (done)
- Endpoint: `/api/deliverables-index`
- Folder scanned: `/Users/coryrisseeuw/.openclaw/workspace/deliverables`
- Ignore helper folders (example: `deliverables/_reports/`)
- Counted categories for progress: `blog`, `gmb`, `l1`, `l2`, `l3`
- Filter: artifact week bucket must overlap selected order weeks
- Week bucket naming must start with `week<start>-<end>` (suffix allowed, e.g. `week16-16-test_1`)
- Counting unit: **unique deliverable unit key** (`week/client/type/post_or_article_folder`)
- Dedup rule: one unit counts once, using latest modified file in that unit
- Done rule: a unit counts as done only when a QC artifact exists and indicates `PASS`
- QC file patterns: `*_qc_v1.md` and `*_qc.md`
- Exclusion: helper folders like `pack_*` are not counted as done units

3. Task movement + risk
- Files: `public/ff_state/week*.json` + `public/ff_state/live.json`
- Used for stage radar, overdue/stuck, WIP load, and production light

## Dashboard formulas

- `Done Today`: done **units** whose latest QC PASS file modification is today
- `To Work On` display:
- `progress_done = min(done_raw, planned_total)`
- `remaining = max(planned_total - progress_done, 0)`
- If `done_raw > planned_total`, dashboard shows extra outputs count separately
- `Production Light = Live`: there is at least one non-complete task in `writer|qc|publisher`
- `Avg written/hour`: `done_raw / elapsed_hours_in_selected_order_range`

This is why you might see more physical files than planned quantity; the progress numerator is capped to planned target for stable tracking, and drafts alone must not increase done progress.

## Order views

- Dashboard supports `Week X-Y` and `All Orders`.
- `All Orders` combines all order windows returned by `/api/order-registry`.

## Kanban status model for agents

- `Inbox`: `human-order` / `planner` items not started
- `Work in progress`: `researcher` / `writer` / `qc` active items
- `Approval`: `qc` items waiting review decision
- `Done`: `publisher` complete items (or publish date passed with complete status)

## Sub-agent ownership + auto movement

- Each task may carry `owner` (`task.owner`) = current sub-agent.
- To move/update tasks without rewriting week files, patch `public/ff_state/live.json`:
- Allowed patch fields: `stage`, `owner`, `eta`, `research_date`, `writer_date`, `qc_date`, `publish_date`, `parent_id`
- UI polls and applies live patches.

Example patch shape:

```json
{
  "updatedAt": "2026-03-12T10:00:00Z",
  "tasks": [
    {
      "id": "dr-2026-w11-bed_bug_bbq-1",
      "stage": "qc",
      "owner": "qc-agent-1",
      "qc_date": "2026-03-12"
    }
  ]
}
```

## Script

- Build a static registry snapshot:

```bash
npm run orders:build
```

- Output file: `public/ff_state/orders.json`
