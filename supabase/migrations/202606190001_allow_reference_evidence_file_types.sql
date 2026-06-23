alter table public.documents
  drop constraint if exists documents_mime_type_check;

alter table public.documents
  add constraint documents_mime_type_not_empty_check
  check (length(trim(mime_type)) > 0);
