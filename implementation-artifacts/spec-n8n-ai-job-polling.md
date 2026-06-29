---
title: 'n8n AI Job Polling'
type: 'feature'
created: '2026-06-29'
status: 'done'
baseline_commit: 'f63adb7c12e53a3e410290ce16cbc9a8c9772566'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Supabase successfully inserts document-processing jobs, but its managed `pg_net` worker times out before reaching the VPS webhook, leaving documents permanently queued.

**Approach:** Add a separate importable n8n workflow that polls Supabase for the oldest queued document job, atomically claims it, and then reuses the established document-processing pipeline.

## Boundaries & Constraints

**Always:** Keep Supabase as the source of truth; poll only `queued` `parse_document` jobs; process at most one job per polling execution; condition the claim on the job still being queued; use existing n8n environment variables and processing nodes; preserve the existing webhook workflow as a rollback option.

**Ask First:** Changing database schema, replacing the document worker contract, or deleting the existing webhook workflow.

**Never:** Embed Supabase credentials in exported JSON; depend on ngrok; download or run a local LLM; process already claimed, completed, or failed jobs; require inbound access from Supabase.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Queued job exists | Oldest `parse_document` job has `status=queued` | Claim once and execute the existing processing chain | Existing job/document failure handling remains authoritative |
| No queued job | Supabase returns an empty array | Execution ends without writes or errors | Normal no-op |
| Concurrent claim | Job changed before claim request | Conditional claim returns no item and processing stops | A later poll selects another queued job |
| Invalid configuration | Required Supabase environment variable is missing | Workflow fails visibly before processing | n8n execution identifies the failing request |

</frozen-after-approval>

## Code Map

- `workflows/n8n/x-assurance-supabase-document-processing.json` -- source workflow whose processing nodes and contracts must be preserved.
- `workflows/n8n/x-assurance-supabase-document-polling.json` -- new deployment workflow using a schedule and Supabase REST query.
- `workflows/n8n/README.md` -- operator instructions for importing, publishing, testing, and disabling the database webhook.

## Tasks & Acceptance

**Execution:**
- [x] `workflows/n8n/x-assurance-supabase-document-polling.json` -- create a valid n8n import containing a 15-second schedule, oldest-job query, conditional claim, and the existing processing chain without webhook response nodes.
- [x] `workflows/n8n/README.md` -- document VPS polling deployment, environment prerequisites, cutover, and verification.

**Acceptance Criteria:**
- Given a queued `parse_document` row, when the polling workflow runs, then it conditionally changes that job to `processing` and continues through document extraction.
- Given no queued jobs, when the polling workflow runs, then it completes as a no-op.
- Given another execution already claimed the selected job, when the conditional claim runs, then no downstream processing occurs.
- Given the workflow is imported, when inspected, then it contains no embedded secrets and requires no Supabase-to-VPS webhook.

## Spec Change Log

## Design Notes

Create a separate workflow so the currently published webhook artifact remains available for later HTTPS deployment. The REST selection orders by `created_at.asc` and limits to one row. The claim request must include both `id=eq.<job_id>` and `status=eq.queued`, with `Prefer: return=representation`; an empty response naturally stops downstream execution.

## Verification

**Commands:**
- `node -e "JSON.parse(require('fs').readFileSync('workflows/n8n/x-assurance-supabase-document-polling.json','utf8'))"` -- expected: JSON parses successfully.
- `npm test` -- expected: application tests remain green.

**Manual checks:**
- Import into n8n, publish it, insert a new queued job by uploading a document, and confirm the job progresses beyond `queued` within approximately 15 seconds.

## Suggested Review Order

**Polling entry point**

- Schedule and oldest-job query replace unreliable inbound webhook delivery.
  [`x-assurance-supabase-document-polling.json:790`](../workflows/n8n/x-assurance-supabase-document-polling.json#L790)

**Race-safe processing**

- Conditional claim ensures only still-queued work can enter processing.
  [`x-assurance-supabase-document-polling.json:102`](../workflows/n8n/x-assurance-supabase-document-polling.json#L102)

- Explicit claim guard stops empty conditional-update responses.
  [`x-assurance-supabase-document-polling.json:834`](../workflows/n8n/x-assurance-supabase-document-polling.json#L834)

**Deployment**

- VPS cutover instructions disable the failed webhook consumer.
  [`README.md:11`](../workflows/n8n/README.md#L11)
