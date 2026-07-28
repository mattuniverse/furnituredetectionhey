-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled project',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);

-- Row Level Security: every user can only see/change their own projects.
alter table public.projects enable row level security;

create policy "Users can view their own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users can insert their own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own projects"
  on public.projects for update
  using (auth.uid() = user_id);

create policy "Users can delete their own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Storage: room photos uploaded during the "Scan Furniture" step
-- (matches the documented flow — Supabase Storage holds the file,
-- the projects.data JSON only holds a path/URL reference to it).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('room-images', 'room-images', true)
on conflict (id) do nothing;

-- Files are stored under {user_id}/{project_id}/{wall}-{timestamp}.jpg — the policies
-- below check that the first path segment matches the signed-in user's id, so people can
-- only upload/read/delete their own photos. "public" bucket + these policies means anyone
-- with a direct link can view a photo (needed to render it back in the app), but only the
-- owner can write or delete.
create policy "Users can upload their own room photos"
  on storage.objects for insert
  with check (bucket_id = 'room-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can view their own room photos"
  on storage.objects for select
  using (bucket_id = 'room-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own room photos"
  on storage.objects for update
  using (bucket_id = 'room-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own room photos"
  on storage.objects for delete
  using (bucket_id = 'room-images' and (storage.foldername(name))[1] = auth.uid()::text);
