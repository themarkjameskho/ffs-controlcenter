# Order Planner Guide

This control center works best when the filesystem is the source of truth and every planning step leaves a readable trail.

This guide describes the auto distribution script.
It does not imply a planner sub-agent; that role is deprecated.

## Folder Model

- Raw inputs live in `/Users/coryrisseeuw/.openclaw/workspace/human_orders/_inbox/`
- Canonical planning outputs live in `/Users/coryrisseeuw/.openclaw/workspace/human_orders/processed/<plan-id>/`
- UI-ready week state lives in `/Users/coryrisseeuw/.openclaw/workspace/fast-forward-control-center/public/ff_state/week*.json`
- Order selection data lives in `/Users/coryrisseeuw/.openclaw/workspace/fast-forward-control-center/public/ff_state/orders.json`
- Optional agent ownership config lives in `/Users/coryrisseeuw/.openclaw/workspace/human_orders/agent-pools.json`

## Why This Is Intuitive

- One inbox for raw orders
- One processed folder per normalized plan
- One week file per operational board slice
- One optional config file for who should own each stage

That keeps the system inspectable without a database:

- Want to know what came in: open `_inbox`
- Want to know what the distribution script decided: open `processed/<plan-id>/agent-distribution.json`
- Want to know what the UI is showing: open `public/ff_state/week*.json`

## Supported Inputs

The planner script accepts:

- CSV files with `client,start_week,end_week,content_type,quantity`
- JSON order files
- Markdown/Text human-order files written as key/value blocks

Example human-order file:

```md
label: April Bed Bug Push
year: 2026

client: Bed Bug BBQ
weeks: 11-15
blog_post: 2
gpp_post: 1
link_2: 1
link_3: 1

client: Chapman Plumbing
week: 16
blog_post: 1
```

## Script

```bash
npm run orders:plan -- --input ../human_orders/_inbox/Test_4.csv
```

Or let it auto-pick the newest supported file in `_inbox`:

```bash
npm run orders:plan
```

Dry run:

```bash
npm run orders:plan -- --dry-run
```

## Output Shape

Each generated plan writes:

- `normalized-order.json`: the clean, canonical input rows
- `agent-distribution.json`: week-by-week task and owner assignments
- `summary.json`: quick metadata for humans

The generated plan is an assignment recommendation.
Completion truth still comes from QC PASS artifacts on disk.

The planner also upserts:

- `public/ff_state/orders.json`
- `public/ff_state/week11.json`, `week12.json`, etc.

## Agent Pools

If `/Users/coryrisseeuw/.openclaw/workspace/human_orders/agent-pools.json` exists, the planner uses it for round-robin stage assignment.

Example:

```json
{
  "planner": ["planner-agent-1"],
  "researcher": ["researcher-agent-1", "researcher-agent-2"],
  "writer": ["writer-agent-1", "writer-agent-2"],
  "qc": ["qc-agent-1"],
  "publisher": ["publisher-agent-1"]
}
```

## Recommended Rule

Treat `agent-distribution.json` as the canonical planning artifact and `week*.json` as the board projection. Treat QC PASS artifacts as the final completion truth.
