-- Create activity logs table to track task changes
create table if not exists public.activity_logs (
    id bigint primary key generated always as identity,
    user_id uuid not null references auth.users(id) on delete cascade,
    task_id bigint not null references public.tasks(id) on delete cascade,
    action_type text not null,
    details jsonb,
    created_at timestamp with time zone default now() not null
);

-- Create index for faster queries
create index if not exists activity_logs_task_id_idx on public.activity_logs (task_id);
create index if not exists activity_logs_user_id_idx on public.activity_logs (user_id);
create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at);

-- Enable row level security
alter table public.activity_logs enable row level security;

-- Users can view activity logs for their own tasks
drop policy if exists "Users can view activity logs for their own tasks" on public.activity_logs;
create policy "Users can view activity logs for their own tasks"
on public.activity_logs
for select
to authenticated
using (
    user_id = auth.uid()
);

-- Users can insert activity logs for their own tasks
drop policy if exists "Users can insert activity logs for their own tasks" on public.activity_logs;
create policy "Users can insert activity logs for their own tasks"
on public.activity_logs
for insert
to authenticated
with check (user_id = auth.uid());
