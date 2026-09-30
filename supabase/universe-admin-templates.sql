-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN: BROWSE UNIVERSE TEMPLATES (all statuses)
-- Run once in the Supabase SQL Editor. Project → SQL Editor → New query.
--
-- Powers the "Universe templates" section in the Admin panel: an admin can
-- scroll every submitted template and filter by status, then click View to
-- open the design READ-ONLY in the 2D/3D editor.
--
-- This is additive. It does not modify universe_list, the approval RPCs, the
-- review queue, or any RLS policy.
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns every Universe post with its moderation status, newest first.
-- Admin-only, and returns zero rows (never an error) for non-admins so a stale
-- or spoofed call cannot be distinguished from "you have nothing to show".
create or replace function public.universe_admin_list()
returns table (
  id            uuid,
  project_id    uuid,
  user_id       uuid,
  caption       text,
  status        text,
  email         text,
  created_at    timestamptz,
  reviewed_at   timestamptz,
  reject_reason text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    up.id,
    up.project_id,
    up.user_id,
    up.caption,
    up.status,
    coalesce(u.email, public.universe_username(up.user_id)),
    up.created_at,
    up.reviewed_at,
    up.reject_reason
  from public.universe_posts up
  left join auth.users u on u.id = up.user_id
  where public.is_admin()
  order by up.created_at desc;
$function$;

-- Lock the function down: only signed-in users may call it, and is_admin()
-- inside the body is what actually gates the rows.
revoke execute on function public.universe_admin_list() from public, anon;
grant  execute on function public.universe_admin_list() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY
-- Run this after installing. Expect: one row per Universe post, and your own
-- email showing role = admin.
-- ─────────────────────────────────────────────────────────────────────────────
--   select * from public.universe_admin_list();
--
-- If it errors with "function public.universe_username does not exist", the
-- live schema differs from what this script assumed. Post the error and we
-- will adjust; do not guess at a replacement.
