# Document Processing Workflow Boundary

Story 2.3 establishes the workflow contract. Supabase remains the state source.

1. Trigger when an `ai_jobs` row is created with `job_type = parse_document` and `status = queued`.
2. n8n claims the job by setting `status = processing`.
3. n8n calls the worker document parser with `project_id`, `document_id`, storage bucket, and storage path.
4. Worker writes parsed chunks to `document_chunks`.
5. Worker/n8n sets `ai_jobs.status = completed` and `documents.processing_status = completed`.
6. On failure, write `ai_jobs.status = failed`, `error_code`, `error_message`, and set the document `processing_status = failed`.

Do not use n8n as the durable state source.
