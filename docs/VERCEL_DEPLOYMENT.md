# Deploying “Online” (Vercel) — Read + Download Markdown

This repo was originally designed as a local Vite app with dev-server endpoints that read your filesystem.

For teammates to access it online, we deploy a **static** snapshot to Vercel:
- teammates can browse dashboards
- teammates can preview and download markdown/text artifacts
- no write actions (no CSV upload, no locate-file, no live patching)

## One-time Vercel setup

1. Create a new Vercel project from this repo.
2. Framework: Vite (auto-detected).
3. Build command: `npm run build`
4. Output directory: `dist`

SPA routing is handled by `vercel.json` in the repo.

## Sanity mode (auto-updating, recommended)

To make the online Control Center update automatically from Charlie/OpenClaw, set these **Vercel Environment Variables**:

- `VITE_DATA_SOURCE=sanity`
- `SANITY_PROJECT_ID` (example: `pjbk2xlq`)
- `SANITY_DATASET`
- `SANITY_API_VERSION`
- `SANITY_READ_TOKEN` (read-only; keep dataset private)

Charlie/OpenClaw writes with:
- `SANITY_WRITE_TOKEN`
- then runs `npm run sanity:sync` (or a pipeline hook) to upsert docs.
- For near-real-time updates on Charlie’s machine, run `npm run sanity:watch`.

Note: `vercel.json` explicitly preserves `/api/*` routes so Vercel Functions work.

## Snapshot workflow (what you run before pushing)

The online site can only serve files that exist inside this repo at build time.

1. Build a snapshot (copies text artifacts into `public/` and generates an index):

```bash
cd /Users/coryrisseeuw/.openclaw/workspace/fast-forward-control-center
npm run snapshot:build
```

Outputs:
- `public/ff_state/deliverables-index.json`
- `public/ff_artifacts/deliverables/**` (copied markdown/text/json/csv/yaml/html only)

2. Commit and push the snapshot changes.
3. Vercel deploys from Git and serves the site.

## What’s available online (read-only)

- Dashboard/Kanban/Calendar read:
  - `public/ff_state/orders.json`
  - `public/ff_state/week*.json`
  - `public/ff_state/live.json` (static snapshot only)
- Artifact preview/download reads:
  - `public/ff_artifacts/**`

## Notes / caveats

- This approach can make the git repo large, depending on how many artifacts you snapshot.
- If you want **live** updates without committing artifacts into git, the next step is to move artifacts + state into shared storage (S3/R2/Drive) and add an authenticated API.
