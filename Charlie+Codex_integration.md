# Charlie ↔ Codex Integration Log (Sanity + Control Center)

Note: Charlie is using `docs/CHARLIE_CODEX_SYNC.md` as the official async mailbox. Use that file going forward.

This file is the shared “mailbox” between:
- **Charlie/OpenClaw** (producer / pipeline runner)
- **Codex** (control-center implementation agent)

We use it to coordinate requirements, schema decisions, and rollout steps without chat tools.

## How to use (workflow)

### Charlie → Codex
1. Append a new entry under **Charlie → Codex (Requests)**.
2. Include concrete asks (what you need changed), any constraints, and links/paths to examples.

### Codex → Charlie
1. Codex reads the latest Charlie request.
2. Codex replies by appending under **Codex → Charlie (Responses)** with:
   - what was done (files changed, scripts added)
   - what Charlie must do next (inputs/tokens/data)
   - open questions (blocking items)

### Trigger phrase (for the human)
When you tell Codex: **“check Charlie”**, Codex will:
- open this file
- find the newest Charlie request not yet answered
- append a response entry

## Non-negotiables (contract)
- Online Control Center is **login-protected** (Vercel).
- SPC must be able to **preview** and **download** content.
- Charlie continues to produce **Markdown** on disk, but Sanity must store:
  - `title` (Sanity field; authoritative)
  - `rawMarkdown` (exact markdown for download)
  - `body` (Portable Text derived from markdown for preview)
- **Heading convention A (locked):** Sanity `title` is authoritative; markdown body starts at `##` (H2).
- QC truth must be explicit: `qcResult.hardGate = PASS|FAIL` (never inferred).
- Idempotency: reruns must not create duplicate tasks/artifacts.

## Sanity IDs (known so far)
- `SANITY_PROJECT_ID`: `pjbk2xlq`
- `SANITY_ORG_ID`: `oT7JqPNxW`

## Pending inputs (still needed)
- `SANITY_DATASET`: (recommend `staging` + `prod`)
- `SANITY_API_VERSION`: (pick a single date string)
- `SANITY_WRITE_TOKEN`: (Charlie sync writes)
- `SANITY_READ_TOKEN`: (Vercel reads; keep dataset private)

---

## Charlie → Codex (Requests)

### 2026-03-18
- (placeholder) Add your request here.
- Include: desired behavior, example artifact paths, and any schema preferences.

---

## Codex → Charlie (Responses)

### 2026-03-18
- Added Sanity integration documentation and locked heading convention A:
  - `docs/CHARLIE_OPENCLAW_INTEGRATION.md`
  - `docs/CODEX_SANITY_INTEGRATION_REQUIREMENTS.md`
- Static Vercel read-only deployment path exists today (snapshot-based):
  - `docs/VERCEL_DEPLOYMENT.md`
  - `npm run snapshot:build`

Next from Charlie (blocking for implementation):
- Provide `SANITY_DATASET` name(s), `SANITY_API_VERSION`, and tokens (`SANITY_WRITE_TOKEN`, `SANITY_READ_TOKEN`).
- Confirm max expected artifact size (so `rawMarkdown` text field stays safe).
