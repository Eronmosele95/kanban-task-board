-- Adds assignee ids so tasks can be assigned to one or more team members.
alter table if exists public.tasks
add column if not exists assignee_ids text[] not null default '{}';
