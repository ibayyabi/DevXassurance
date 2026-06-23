# Project Access Model RLS Verification

Manual verification for Story 1.3 when Supabase CLI or a hosted Supabase project is available.

1. Apply migrations in `supabase/migrations`.
2. Create two authenticated users.
3. Insert matching `profiles` rows for both users.
4. Insert one `project_members` row for user A on project A.
5. Insert one `project_members` row for user B on project B.
6. Authenticate as user A and run:

```sql
select id, name from public.projects;
select project_id, user_id, role from public.project_members;
```

Expected result: user A sees only project A and memberships attached to project A.

7. Repeat as user B.

Expected result: user B sees only project B and memberships attached to project B.

8. Run both queries with no authenticated JWT.

Expected result: no project or membership rows are returned.
