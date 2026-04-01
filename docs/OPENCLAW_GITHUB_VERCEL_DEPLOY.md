# OpenClaw Runbook: Commit to GitHub + Deploy to Vercel (Control Center)

This doc is for the OpenClaw operator (Charlie) to keep the **Fast Forward Control Center** online and accessible to the team.

Repo: `https://github.com/themarkjameskho/ffs-controlcenter`

Vercel deploy (already created): `ffscontrolcenter-git-main-hmstr-ai-306b1248.vercel.app`

## What “updates automatically” means

There are two different kinds of updates:

1) **Control Center app updates (code/UI)**  
   - ✅ Auto-deploys on Vercel **when you push to GitHub** (usually `main`).

2) **Dashboard/content updates (data)**  
   - The online Control Center reads from **Sanity** when `VITE_DATA_SOURCE=sanity`.
   - ✅ Updates online when OpenClaw syncs new/changed Markdown + task state into Sanity (typically via `sanity:watch` on the production machine).
   - Pushing code to GitHub does **not** upload content to Sanity by itself.

## A) Commit + push to GitHub (OpenClaw machine)

You have two safe ways to authenticate Git operations from a machine:

### Option A1: SSH key (recommended for machines/agents)

1) Create an SSH key on the OpenClaw machine (one time).
2) Add the **public** key to GitHub as one of:
   - **Deploy key** (repo-scoped; simplest for a single repo), or
   - **SSH key** on a GitHub user account (broader access).
3) Set the repo remote URL to SSH form:
   - `git@github.com:themarkjameskho/ffs-controlcenter.git`
4) Push changes to the branch you use (usually `main`).

Notes:
- Deploy keys can be read-only or read-write. For pushing, it must be **read-write**.
- Keep the **private** key only on the machine and never commit it.

### Option A2: HTTPS + Personal Access Token (PAT)

Use this only if SSH isn’t available.

1) In GitHub, create a **Personal Access Token**:
   - Settings → Developer settings → Personal access tokens
   - Choose fine-grained token (preferred) with access to this repo.
2) Use the token as the password when pushing over HTTPS.

Notes:
- PATs are secrets. Do not paste them into markdown docs, chat logs, or commit history.

## B) Vercel: Connect GitHub repo and enable auto-deploy

This is usually a one-time setup (already done for this project).

1) In Vercel, open the project for this deployment.
2) Confirm **Git Integration** is connected to:
   - Repo: `themarkjameskho/ffs-controlcenter`
   - Production Branch: `main`
3) Confirm build settings:
   - Framework: Vite (or “Other” is fine if it builds)
   - Build command: `npm run build`
   - Output: `dist`

After this:
- Every push to `main` triggers a new Production deployment.
- Every PR branch triggers a Preview deployment (if enabled).

## C) Vercel Environment Variables (Sanity mode)

For the online dashboard to show data, Vercel needs these env vars:

- `VITE_DATA_SOURCE=sanity`
- `SANITY_PROJECT_ID`
- `SANITY_DATASET`
- `SANITY_API_VERSION`
- `SANITY_READ_TOKEN` (read-only token recommended)

Important:
- Vercel env var changes apply only after a **redeploy**.
- Never paste tokens into terminals without quotes if your shell might split lines/spaces.

## D) “The site is empty” checklist (most common issue)

If the deployed Control Center loads but dashboards are empty:

1) Verify Vercel env vars are set correctly (esp. dataset name).
2) Verify Sanity actually contains docs:
   - `client`, `orderWindow`, `task`, `artifact`
3) Verify OpenClaw is running the sync on the production machine:
   - Sync needs access to:
     - `public/ff_state/week*.json` (tasks)
     - `../deliverables/**/*.md` (artifacts)
   - The **Vercel server cannot see your filesystem**, so the sync must happen from a machine that has the files.

## E) Redeploying without code changes (when only env vars changed)

In Vercel:
- Deployments → Redeploy latest (or “Promote” if using a preview build)

Use this after:
- Changing `SANITY_*` env vars
- Fixing a token or dataset name

## F) Login protection (team-only access)

Use Vercel’s built-in protection (recommended):
- Project Settings → Deployment Protection / Authentication

Goal:
- Only teammates in the Vercel team can access the Control Center.

