-- ─────────────────────────────────────────────────────────────
-- UNIVERSE FEED — schema, RLS, and RPCs
-- Run AFTER supabase/schema.sql (it relies on user_profiles and is_admin()).
-- Safe to re-run: everything is idempotent.
--
-- What this adds:
--   • user_profiles.username / display_name / avatar_url  (public feed identity)
--   • universe_posts        — public snapshot of a published design
--   • universe_likes        — per-user like flags on posts
--   • RPCs used by the app:
--       universe_list()                 all posts, newest first, with like counts
--       universe_profile_for(uid)       a user's public profile info
--       universe_posts_for(uid)         one user's published posts (profile grid)
--       universe_update_profile(...)    edit own username/display name/avatar
--       universe_publish(pid, caption)  publish (or update) a template from a project
--       universe_unpublish(post_id)     owner or admin removes a post
--       universe_toggle_like(post_id)   like/unlike; returns the new state
--       universe_admin_list()           moderation list (admin only)
--       universe_admin_remove(post_id)  admin removes any post
--
-- Security model:
--   • Only owners can insert/update/delete their own posts; admins may delete any.
--   • The feed, public profiles, and posts-by-user go through security-definer
--     RPCs so any signed-in user can view any published template — but the
--     private projects table stays locked to its owner.
-- ─────────────────────────────────────────────────────────────

-- ── 1) Public feed identity on user_profiles (nullable until the user sets them).
alter table public.user_profiles
  add column if not exists username text unique default null,
  add column if not exists display_name text default null,
  add column if not exists avatar_url text default null;

-- ── 1b) Public flag on projects + RLS.
-- Published projects carry is_public = true so ANY signed-in user can read them
-- directly from public.projects (regardless of user_id), while writes stay with
-- the owner. The flag is set to true by universe_publish() and cleared again by
-- universe_unpublish(); the feed itself is served from universe_posts snapshots.
alter table public.projects
  add column if not exists is_public boolean not null default false;

create policy "Authenticated users can view public projects"
  on public.projects for select
  using (is_public and auth.role() = 'authenticated');

-- ── 1c) "Saved from Universe" marker on projects.
-- save_universe_project() copies a Universe post into the caller's account and
-- stamps source_post_id on the copy. my_projects() (user-created) and
-- my_saved_projects() (imported from the feed) use it to tell the two apart.
-- The source may later be deleted or unshared without affecting the saved copy.
alter table public.projects
  add column if not exists source_post_id uuid;

create index if not exists projects_source_post_idx
  on public.projects(source_post_id) where source_post_id is not null;

-- ── 2) Universe posts: a COPY of the design data taken at publish time, so a
-- published template is a stable public snapshot while the source project
-- remains private. One post per project if linked (users may publish again to
-- update the snapshot).
create table if not exists public.universe_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  caption text not null default '',
  data jsonb not null,
  is_official boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists universe_posts_project_key
  on public.universe_posts(project_id) where project_id is not null;
create index if not exists universe_posts_created_idx
  on public.universe_posts(created_at desc);
create index if not exists universe_posts_user_idx
  on public.universe_posts(user_id);

alter table public.universe_posts enable row level security;

-- Any signed-in user can view published templates.
create policy "Signed-in users can view universe posts"
  on public.universe_posts for select
  using (auth.role() = 'authenticated');

-- Only the owner can create entries (users cannot publish on behalf of others).
create policy "Owners can create universe posts"
  on public.universe_posts for insert
  with check (auth.uid() = user_id);

-- Owners can edit their own posts; admins can moderate any post.
create policy "Owners can update their universe posts"
  on public.universe_posts for update
  using (auth.uid() = user_id);

create policy "Owners and admins can delete universe posts"
  on public.universe_posts for delete
  using (auth.uid() = user_id or public.is_admin());

-- ── 3) Likes.
create table if not exists public.universe_likes (
  post_id uuid not null references public.universe_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.universe_likes enable row level security;

create policy "Signed-in users can view likes"
  on public.universe_likes for select
  using (auth.role() = 'authenticated');

create policy "Users can like posts"
  on public.universe_likes for insert
  with check (auth.uid() = user_id);

create policy "Users can unlike posts"
  on public.universe_likes for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 4) RPCs
-- ─────────────────────────────────────────────────────────────

-- The whole feed, newest first, with like counts and the caller's own like flag.
-- Returns a human-friendly kind ("Living Room" | "Floor Plan") for the card meta.
create or replace function public.universe_list()
returns table (
  id uuid,
  user_id uuid,
  project_id uuid,
  caption text,
  data jsonb,
  kind text,
  is_official boolean,
  created_at timestamptz,
  likes bigint,
  my_like boolean,
  username text,
  display_name text,
  avatar_url text
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id, p.project_id, p.caption, p.data,
    case when p.data->>'type' = 'floor'
         then 'Floor Plan'
         else coalesce(p.data->'roomConfig'->>'type', 'Room') end,
    p.is_official, p.created_at,
    (select count(*) from public.universe_likes l where l.post_id = p.id),
    exists(select 1 from public.universe_likes l where l.post_id = p.id and l.user_id = auth.uid()),
    coalesce(pr.username, split_part(u.email, '@', 1), 'user'),
    coalesce(pr.display_name, split_part(u.email, '@', 1), 'user'),
    coalesce(pr.avatar_url, '')
  from public.universe_posts p
  join auth.users u on u.id = p.user_id
  left join public.user_profiles pr on pr.user_id = p.user_id
  order by p.created_at desc;
$$;

-- Public profile header for any user (shown on their profile screen).
create or replace function public.universe_profile_for(target uuid)
returns table (user_id uuid, username text, display_name text, avatar_url text, joined timestamptz, post_count bigint)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    coalesce(pr.username, split_part(u.email, '@', 1), 'user'),
    coalesce(pr.display_name, split_part(u.email, '@', 1), 'user'),
    coalesce(pr.avatar_url, ''),
    coalesce(pr.created_at, u.created_at),
    (select count(*) from public.universe_posts p where p.user_id = u.id)
  from auth.users u
  left join public.user_profiles pr on pr.user_id = u.id
  where u.id = target;
$$;

-- One user's published posts, newest first (profile grid).
create or replace function public.universe_posts_for(target uuid)
returns table (
  id uuid, user_id uuid, project_id uuid, caption text, data jsonb, kind text,
  is_official boolean, created_at timestamptz, likes bigint, my_like boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id, p.project_id, p.caption, p.data,
    case when p.data->>'type' = 'floor'
         then 'Floor Plan'
         else coalesce(p.data->'roomConfig'->>'type', 'Room') end,
    p.is_official, p.created_at,
    (select count(*) from public.universe_likes l where l.post_id = p.id),
    exists(select 1 from public.universe_likes l where l.post_id = p.id and l.user_id = auth.uid())
  from public.universe_posts p
  join auth.users u on u.id = p.user_id
  where p.user_id = target
  order by p.created_at desc;
$$;

-- Edit your own public feed identity. Role is intentionally NOT touchable here
-- (it is only changed via the manual admin SQL in schema.sql).
create or replace function public.universe_update_profile(
  new_username text default null,
  new_display_name text default null,
  new_avatar_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.user_profiles
  set username      = coalesce(nullif(trim(coalesce(new_username, '')), ''), username),
      display_name  = coalesce(nullif(trim(coalesce(new_display_name, '')), ''), display_name),
      avatar_url    = coalesce(nullif(trim(coalesce(new_avatar_url, '')), ''), avatar_url)
  where user_id = auth.uid();
end $$;

-- Publish (or re-publish) one of the caller's projects as a public template.
-- Takes a fresh snapshot of the design data; admins' posts are marked Official.
-- One live post per project: re-publishing updates the same row.
create or replace function public.universe_publish(pid uuid, pcap text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  vpost uuid;
  vdata jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select data into vdata
    from public.projects
    where id = pid and user_id = auth.uid();
  if vdata is null then
    raise exception 'Project not found, or it does not belong to you';
  end if;
  insert into public.universe_posts (user_id, project_id, caption, data, is_official)
  values (auth.uid(), pid, coalesce(nullif(trim(pcap), ''), ''), vdata, public.is_admin())
  on conflict (project_id) do update
    set caption = excluded.caption,
        data = excluded.data,
        is_official = excluded.is_official,
        updated_at = now()
  returning id into vpost;
  -- Mark the source project public so any signed-in user can read it too.
  update public.projects set is_public = true where id = pid;
  return vpost;
end $$;

-- Owner or admin removes a post. Returns true if something was removed.
-- When an owner unpublishes, their source project becomes private again.
create or replace function public.universe_unpublish(post_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  vpid uuid;
begin
  select project_id into vpid from public.universe_posts where id = post_id;
  delete from public.universe_posts
    where id = post_id and (user_id = auth.uid() or public.is_admin());
  if found then
    update public.projects set is_public = false
      where id = vpid and user_id = auth.uid();
    return true;
  end if;
  raise exception 'Post not found, or you cannot unpublish it';
end $$;

-- Like/unlike toggle. Returns the new state (true = liked).
create or replace function public.universe_toggle_like(post_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists(select 1 from public.universe_posts where id = post_id) then
    if exists(select 1 from public.universe_likes where post_id = post_id and user_id = auth.uid()) then
      delete from public.universe_likes where post_id = post_id and user_id = auth.uid();
      return false;
    else
      insert into public.universe_likes (post_id, user_id) values (post_id, auth.uid())
        on conflict (post_id, user_id) do nothing;
      return true;
    end if;
  end if;
  raise exception 'Post not found';
end $$;

-- Moderation list (admin only): every post with its owner's email.
create or replace function public.universe_admin_list()
returns table (id uuid, email text, caption text, is_official boolean, created_at timestamptz, likes bigint)
language sql stable security definer set search_path = public as $$
  select p.id, u.email, p.caption, p.is_official, p.created_at,
         (select count(*) from public.universe_likes l where l.post_id = p.id)
  from public.universe_posts p
  join auth.users u on u.id = p.user_id
  where public.is_admin()
  order by p.created_at desc;
$$;

-- Admin only: remove any post (moderation).
create or replace function public.universe_admin_remove(post_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  delete from public.universe_posts where id = post_id;
  return found;
end $$;

-- ── 4b) Universe "save" + My/Saved project lists ──
-- Copies a published Universe post into the caller's account as an editable
-- project and returns the new project id. The saved copy is independent of the
-- original post (deleting or unpublishing the source doesn't touch it).
create or replace function public.save_universe_project(target_post_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  vdata jsonb;
  vname text;
  vnew uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select data into vdata
    from public.universe_posts
    where id = target_post_id;
  if vdata is null then
    raise exception 'Project not found in Universe';
  end if;
  vname := 'Copy of '
        || case when vdata->>'type' = 'floor'
                then 'Floor Plan'
                else coalesce(vdata->'roomConfig'->>'type', 'Room')
           end
        || ' template';
  insert into public.projects (user_id, name, data, is_public, source_post_id)
  values (auth.uid(), vname, vdata, false, target_post_id)
  returning id into vnew;
  return vnew;
end $$;

-- Projects the current user created themselves (not imported from Universe).
create or replace function public.my_projects()
returns table (id uuid, name text, data jsonb, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.data, p.created_at, p.updated_at
  from public.projects p
  where p.user_id = auth.uid()
    and p.source_post_id is null
  order by p.updated_at desc;
$$;

-- Projects the current user saved from Universe (copied in from the feed).
create or replace function public.my_saved_projects()
returns table (id uuid, name text, data jsonb, saved_at timestamptz, source_post_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.data, p.created_at, p.source_post_id
  from public.projects p
  where p.user_id = auth.uid()
    and p.source_post_id is not null
  order by p.created_at desc;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5) Access control for the RPCs
-- Supabase grants EXECUTE on new functions to 'public' by default,
-- which would let anonymous callers read the feed & profiles. Withdraw
-- that and allow only signed-in users to call any Universe function.
-- ─────────────────────────────────────────────────────────────
revoke execute on function public.universe_list() from public;
revoke execute on function public.universe_profile_for(uuid) from public;
revoke execute on function public.universe_posts_for(uuid) from public;
revoke execute on function public.universe_update_profile(text, text, text) from public;
revoke execute on function public.universe_publish(uuid, text) from public;
revoke execute on function public.universe_unpublish(uuid) from public;
revoke execute on function public.universe_toggle_like(uuid) from public;
revoke execute on function public.universe_admin_list() from public;
revoke execute on function public.universe_admin_remove(uuid) from public;
revoke execute on function public.save_universe_project(uuid) from public;
revoke execute on function public.my_projects() from public;
revoke execute on function public.my_saved_projects() from public;

grant execute on function public.universe_list() to authenticated;
grant execute on function public.universe_profile_for(uuid) to authenticated;
grant execute on function public.universe_posts_for(uuid) to authenticated;
grant execute on function public.universe_update_profile(text, text, text) to authenticated;
grant execute on function public.universe_publish(uuid, text) to authenticated;
grant execute on function public.universe_unpublish(uuid) to authenticated;
grant execute on function public.universe_toggle_like(uuid) to authenticated;
grant execute on function public.universe_admin_list() to authenticated;
grant execute on function public.universe_admin_remove(uuid) to authenticated;
grant execute on function public.save_universe_project(uuid) to authenticated;
grant execute on function public.my_projects() to authenticated;
grant execute on function public.my_saved_projects() to authenticated;