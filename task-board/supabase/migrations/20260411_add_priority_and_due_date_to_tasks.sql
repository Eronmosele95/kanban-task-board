-- Adds task priority levels and optional due dates.
alter table if exists public.tasks
add column if not exists priority text not null default 'medium';

alter table if exists public.tasks
drop constraint if exists tasks_priority_check;

alter table if exists public.tasks
add constraint tasks_priority_check check (priority in ('low', 'medium', 'high'));

alter table if exists public.tasks
add column if not exists due_date date;
