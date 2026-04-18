-- Adds the missing description column used by task creation in the app.
alter table if exists public.tasks
add column if not exists description text;
