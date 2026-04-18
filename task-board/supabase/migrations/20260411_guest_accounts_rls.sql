-- Adds per-user ownership to tasks and enforces guest-user isolation via RLS.
alter table if exists public.tasks
add column if not exists user_id uuid;

alter table if exists public.tasks
alter column user_id set default auth.uid();

create index if not exists tasks_user_id_idx on public.tasks (user_id);

alter table if exists public.tasks
enable row level security;

drop policy if exists "Users can view their own tasks" on public.tasks;
create policy "Users can view their own tasks"
on public.tasks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own tasks" on public.tasks;
create policy "Users can insert their own tasks"
on public.tasks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own tasks" on public.tasks;
create policy "Users can update their own tasks"
on public.tasks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own tasks" on public.tasks;
create policy "Users can delete their own tasks"
on public.tasks
for delete
to authenticated
using (auth.uid() = user_id);

-- Set NOT NULL only when all existing rows already have owners.
do $$
begin
    if exists (select 1 from public.tasks where user_id is null) then
        raise notice 'tasks.user_id still has null rows. NOT NULL constraint was skipped.';
    else
        alter table public.tasks alter column user_id set not null;
    end if;
end $$;