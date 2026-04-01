# Pipeline Markers (.ff) + Artifact Filtering (Codex Implementation Contract)

This document is the **authoritative contract** Codex must follow when implementing event-driven QC + Control Center artifact filtering.

## Why this exists
We want QC to run **only when Writer is done** (no cron / no polling), while keeping the Control Center UI clean and not overpopulated with internal JSON files.

---

## 1) Artifact folders (existing)
Deliverables live under:

`deliverables/<week>/<client_slug>/<workflow>/post_<NN>/...`

Example:

`deliverables/week11-15/heat_tech_bed_bug/blog_post/post_07/`

Visible, human-facing artifacts commonly include:
- `*_draft.md` (current workflow; later may become `*.md` without “draft”)
- `*_qc_v1.md`
- `*_draft_lint.json` (optional visibility; can be hidden if noisy)

**Do not rename** existing deliverable files.

---

## 2) Marker folder (new)
Each post folder may contain an internal metadata directory:

`post_<NN>/.ff/`

Everything under `.ff/` is **pipeline metadata** and must be:
- ignored by artifact feeds
- not shown as deliverables
- not treated as a user-facing “task” artifact

---

## 3) Marker files (schemas)

### 3.1 Writer completion marker (QC trigger)
Path:
- `.ff/writer_done.json`

Schema:
```json
{
  "stage": "writer_done",
  "content_relpath": "<relative path from post folder to content md file>",
  "timestamp": "<ISO8601 with timezone>"
}
```

Notes:
- QC triggers off this marker (not off filename patterns like `*_draft.md`).
- This is future-proof when content stops being called “draft”.

### 3.2 QC completion marker (Control Center status)
Path:
- `.ff/qc_done.json`

Schema:
```json
{
  "stage": "qc_done",
  "qc_status": "pass",
  "qc_relpath": "<relative path from post folder to qc report md file>",
  "timestamp": "<ISO8601 with timezone>"
}
```

`qc_status` must be one of: `pass | fail`.

### 3.3 Publish status marker (Publishing readiness + online dashboard)
Path:
- `.ff/publish_status.json`

Schema:
```json
{
  "stage": "publish_status",
  "status": "not_uploaded",
  "timestamp": "<ISO8601 with timezone>",
  "details": {
    "cms": "sanity",
    "cms_doc_id": "<optional>",
    "url": "<optional>"
  }
}
```

`status` should be one of:
- `not_uploaded` (content exists locally only)
- `draft` (uploaded as a draft in the client CMS)
- `ready` (ready to publish; all gates satisfied)
- `published` (live)

### 3.4 Image status marker (Publisher/image consolidation gate)
Path:
- `.ff/image_status.json`

Schema:
```json
{
  "stage": "image_status",
  "status": "missing",
  "timestamp": "<ISO8601 with timezone>",
  "details": {
    "count": 0,
    "notes": "<optional>"
  }
}
```

`status` should be one of: `missing | ready`.

### 3.5 Revision log (optional but recommended for “revisions” dashboards)
Path:
- `.ff/revision_log.json`

Schema:
```json
{
  "stage": "revision_log",
  "events": [
    {
      "timestamp": "<ISO8601 with timezone>",
      "actor": "writer",
      "reason": "qc_fix",
      "notes": "<optional>"
    }
  ]
}
```

---

## 4) Event-driven QC (no cron)
Codex must implement QC as **per-post** activation:

1) Detect `**/.ff/writer_done.json` (new or updated)
2) Read `content_relpath`
3) Run QC for that post
4) Write `*_qc_v1.md` to the post folder
5) Write `**/.ff/qc_done.json`
6) Trigger a **single** Control Center sync/update after each post QC completes

Idempotency requirement:
- If `.ff/qc_done.json` exists and is up-to-date, QC should not re-run unnecessarily.

---

## 5) Control Center filtering rules (must-have)
Any Control Center indexing / listing / artifact feed must exclude:

### 5.1 Hidden pipeline directory
- Any folder named `.ff` anywhere in deliverables
- Any file under `.ff/`

### 5.2 General noise exclusions
Exclude these from UI feeds:
- `.DS_Store`
- any path containing `/.git/`

### 5.3 Optional: hide lint JSON
If `*_draft_lint.json` is cluttering UI, exclude:
- `*_draft_lint.json`

(We can still keep lint data for automation; it just shouldn’t appear as a user-facing artifact.)

---

## 6) Control Center semantics
The Control Center should treat only these as **user-facing artifacts**:
- content markdown (`*.md`) that represents the draft/final content
- QC report markdown (`*_qc_v1.md`)

Everything else is internal metadata unless explicitly surfaced by design.

---

## 7) Compatibility notes
- This design is compatible with today’s naming (`*_draft.md`) and future naming (no “draft” in filename).
- The trigger is marker-based; filenames remain stable for humans.

---

## 8) Summary (non-negotiables)
- QC must be event-driven (no cron).
- Markers must be written under `.ff/`.
- `.ff/` must be fully hidden from Control Center artifact listings.
