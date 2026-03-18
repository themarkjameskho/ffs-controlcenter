# Kanban AI Guide (Sub-Agents)

This guide defines exactly how AI/sub-agents should read and update Kanban data.

## Goal

Keep Kanban accurate, deterministic, and aligned with workflow state.

Target contract:
- Group cards by `Assigned` / `task.owner`
- Treat QC PASS as the only true Done signal
- Use `live.json` only for reversible operational movement, never to invent completion

## Data Sources

1. Order windows
- API: `/api/order-registry`
- Built from CSV files in:
- `/Users/coryrisseeuw/.openclaw/workspace/human_orders/_inbox/`

2. Base task state
- Files: `public/ff_state/week*.json`
- Contains canonical task rows.

3. Live movement/state overrides
- File: `public/ff_state/live.json`
- Used for fast stage/owner/date updates without rewriting week files.

## Kanban Columns (Legacy UI)

The current UI still has 4 columns, but this is a legacy projection.
Do not deepen lane-specific logic further; the desired model is assigned-driven.

The Kanban UI has 4 columns:
- `Inbox`
- `Work In Progress`
- `Approval`
- `Done`

Underlying stages are still:
- `human-order`, `planner`, `researcher`, `writer`, `qc`, `publisher`

Lane mapping:
- `Inbox` = `human-order` + `planner`
- `Work In Progress` = `researcher` + `writer`
- `Approval` = `qc`
- `Done` = `publisher`

## Drag/Drop Mapping Rules

When an item is moved to a lane, map to stage deterministically:
- Drop to `Inbox`:
- `human_order` type stays `human-order`
- all other types become `planner`
- Drop to `Work In Progress`:
- keep `researcher` if already `researcher`
- keep `writer` if already `writer`
- `research_pack` defaults to `researcher`
- otherwise default to `writer`
- Drop to `Approval` -> `qc`
- Drop to `Done` -> `publisher`

## Required Card Fields

Each card should expose:
- `Task Title`
- `Client` (pill style)
- `Assigned: <sub-agent>` (from `owner`)
- `Description`
- `ETA`

Field source map:
- Task Title: `task.title` fallback to generated title
- Client: `task.client_slug` resolved via `clients.json`
- Assigned: `task.owner` (fallback `Unassigned`)
- Description: `task.description` fallback by `task.type`
- ETA: stage date fallback chain:
- `research_date` / `writer_date` / `qc_date` / `publish_date` / `eta`

## Live Update Contract (`live.json`)

Use `id`-based patches.

Allowed patch fields:
- `stage`
- `owner`
- `eta`
- `research_date`
- `writer_date`
- `qc_date`
- `publish_date`
- `parent_id`

Example:

```json
{
  "year": 2026,
  "week": 11,
  "updatedAt": "2026-03-12T18:00:00Z",
  "tasks": [
    {
      "id": "dr-2026-w11-bed_bug_bbq-1",
      "stage": "qc",
      "owner": "qc-agent",
      "qc_date": "2026-03-12"
    }
  ]
}
```

## Agent Workflow

1. Read active order range from `/api/order-registry`.
2. Read matching `week*.json` tasks.
3. Apply `live.json` patches by task `id`.
4. Validate each task has correct lane-stage mapping.
5. If ownership or dates change, patch `live.json`.
6. Avoid random re-stage actions; only move based on clear completion signals.
7. Do not move a task to Done unless the underlying deliverable unit has QC PASS proof.

## Safety Rules

- Do not change visual styling in code unless owner explicitly approves.
- Do not delete historical week files.
- Keep updates deterministic and reversible.
- Prefer patching `live.json` for operational movement; reserve week-file rewrites for planned state rebuilds.
- Do not let `live.json` override QC truth.
