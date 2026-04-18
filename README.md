# kanban-task-board

Fully capable Kanban-style task board where users can create tasks, drag them across board sections, and manage work visually.

## Database migration

This app expects a `description` column on `public.tasks`.

This app also expects a `user_id` column and RLS policies so each guest user only sees their own tasks.

Migration file:

- `supabase/migrations/20260410_add_description_to_tasks.sql`
- `supabase/migrations/20260411_guest_accounts_rls.sql`
- `supabase/migrations/20260411_add_priority_and_due_date_to_tasks.sql`
- `supabase/migrations/20260412_add_assignee_ids_to_tasks.sql`

If you want to apply it directly in the Supabase SQL Editor, run:

```sql
alter table if exists public.tasks
add column if not exists description text;

alter table if exists public.tasks
add column if not exists user_id uuid;

alter table if exists public.tasks
alter column user_id set default auth.uid();

alter table if exists public.tasks
enable row level security;

create policy "Users can view their own tasks"
on public.tasks
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own tasks"
on public.tasks
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own tasks"
on public.tasks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own tasks"
on public.tasks
for delete
to authenticated
using (auth.uid() = user_id);
```

## Auth Requirement

Enable anonymous sign-ins in your Supabase project:

- Supabase Dashboard -> Authentication -> Providers -> Anonymous -> Enable
