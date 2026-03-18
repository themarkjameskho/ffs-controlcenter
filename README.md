# Fast Forward Control Center

Kanban + Calendar UI for the production workflow:

`human-order -> auto distribution -> research -> write -> lint -> qc -> done`

Global done rule: a deliverable is done only when a QC artifact indicates `PASS`.

## Run

```bash
npm install
npm run dev
```

## Deploy (Vercel, Read-Only)

If teammates only need to **read** dashboards and **download markdown** artifacts, deploy a static snapshot to Vercel:

- Guide: `docs/VERCEL_DEPLOYMENT.md`
- Charlie/OpenClaw integration plan (Sanity-backed, auto-updating): `docs/CHARLIE_OPENCLAW_INTEGRATION.md`

## CSV Uploader (No Generator)

`CSV Importer 1` uploads selected CSV files directly into:

`.openclaw/workspace/human_orders/_inbox/`

Important:

- The uploader only copies files to inbox.
- It does **not** generate `week11.json`.
- A sub-agent/process is expected to update Kanban/Calendar data.

## Order Registry Snapshot

Build the order registry JSON from the latest inbox CSV:

```bash
npm run orders:build
```

Output: `public/ff_state/orders.json`

When the dev server is running, `/api/order-registry` now auto-refreshes from `../human_orders/_inbox/` if a newer CSV appears than the saved snapshot. That means new order windows should show up in the UI without a manual `orders:build`.

## Agent Planning

Turn a CSV or a human-order file into:

- a canonical plan folder in `../human_orders/processed/<plan-id>/`
- updated week-state files in `public/ff_state/week*.json`
- an order snapshot in `public/ff_state/orders.json`

Examples:

```bash
npm run orders:plan -- --input ../human_orders/_inbox/Test_4.csv
npm run orders:plan -- --input ../human_orders/_inbox/example-human-order.md
```

The distribution script also reads `../human_orders/agent-pools.json` if present so task ownership stays folder-based and editable.

Important:
- a new CSV should appear in order selection automatically
- week/task cards still require the distribution script or generated week-state files

## Data Files

- Kanban/Calendar data source: `public/ff_state/week11.json`
- Live patch source: `public/ff_state/live.json`

## UI Policy

- Appearance is locked until owner approval: see `docs/APPEARANCE_LOCK.md`
- Codex/OpenClaw implementation spec: `docs/CODEX_CONTROL_CENTER_SPEC.md`
- QC PASS migration plan: `docs/QC_PASS_MIGRATION_PLAN.md`
- Dashboard data guide for AI/sub-agents: `docs/DASHBOARD_DATA_GUIDE.md`
- Data Charlie/OpenClaw must provide for useful dashboards: `docs/CHARLIE_DATA_REQUIREMENTS.md`
- Kanban AI/sub-agent guide: `docs/KANBAN_AI_GUIDE.md`
- Order planner guide: `docs/ORDER_PLANNER_GUIDE.md`
- OpenClaw runbook: `docs/OPENCLAW_RUNBOOK.md`
