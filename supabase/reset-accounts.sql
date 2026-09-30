-- ─────────────────────────────────────────────────────────────────────────────
-- RESET ACCOUNTS: delete existing users, then create one ADMIN + one USER
-- Run once in the Supabase SQL Editor. Project → SQL Editor → New query.
--
-- Both accounts are created ALREADY CONFIRMED, so you can sign in immediately
-- with no email code and no inbox access.
--
--   ADMIN  email: admin@floorplan.studio
--          pass:  Admin12345!
--   USER   email: user@floorplan.studio
--          pass:  User12345!
--
-- ⚠ CHANGE THE PASSWORDS BEFORE USING THIS ANYWHERE REAL.
--   These are throwaway local credentials committed to a public git repo.
--
-- ⚠ DELETE IS DESTRUCTIVE AND CASCADES.
--   Deleting an auth.users row also removes that user's:
--     • user_profiles row        (FK, on delete cascade)
--     • projects                 (their floor plans — NOT recoverable)
--     • universe_posts           (their Universe submissions, incl. approved)
--     • storage.objects          (orphaned, NOT auto-deleted — see step 1c)
--   Run step 1 FIRST and read the numbers before you run step 2.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1 — PREVIEW. Run this and READ THE OUTPUT before deleting anything.
-- ═════════════════════════════════════════════════════════════════════════════
select
  u.email,
  p.role,
  (u.email_confirmed_at is not null)                as confirmed,
  coalesce(pr.projects, 0)                          as projects_owned,
  coalesce(up.posts, 0)                             as universe_posts,
  coalesce(up.approved_posts, 0)                    as approved_posts
from auth.users u
left join public.user_profiles p on p.user_id = u.id
left join lateral (
  select count(*) as projects from public.projects where user_id = u.id
) pr on true
left join lateral (
  select count(*) as posts, count(*) filter (where status = 'approved') as approved_posts
  from public.universe_posts where user_id = u.id
) up on true
order by u.created_at;

-- 1b. Confirm you are NOT deleting the account you are currently signed in as
--     if you plan to keep working in this project.
-- select email from auth.users;

-- 1c. Optional: list storage files that would be orphaned by the delete.
-- select (storage.foldername(name))[1] as owner_id, count(*)
-- from storage.objects where bucket_id = 'room-images' group by 1;


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2 — DELETE. Replace the email list with exactly what you want gone.
--
-- ⚠ DO NOT delete every account unless you are certain you can still create a
--   new admin afterwards. If you delete your only admin and the create step
--   fails, you are locked out of the Admin panel until someone runs SQL.
-- ═════════════════════════════════════════════════════════════════════════════
delete from auth.users
where lower(email) in (
  'daquitajustin@gmail.com',
  'admin@floorplan.com',
  'admin@floorplan.studio'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 3 — CREATE the admin + the user (one transaction, both or neither).
--
-- Safe to re-run: upserts on id, and the identity row is replaced each time,
-- so running this twice changes nothing and cannot duplicate an account.
-- ═════════════════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

do $$
declare
  v_inst uuid;
  r      record;
begin
  -- Real instance id, rather than hardcoding all-zeros.
  select id into v_inst from auth.instances limit 1;

  -- auth.users.email is UNIQUE. An earlier signup may already occupy one of
  -- these addresses under a different id (for example the unconfirmed
  -- admin@floorplan.studio created before email codes were switched off).
  -- The upsert below only matches on id, so that stale row would raise a unique
  -- violation and roll back BOTH accounts. Clear conflicting ids first.
  delete from auth.users
  where lower(email) in ('admin@floorplan.studio','user@floorplan.studio')
    and id not in ('11111111-1111-1111-1111-111111111111',
                   '22222222-2222-2222-2222-222222222222');

  -- Both accounts from one row source. A loop is used rather than a nested
  -- procedure because PL/pgSQL only allows subprogram declarations in a block's
  -- declaration section, never after the block body has started.
  for r in
    select * from (values
      ('11111111-1111-1111-1111-111111111111'::uuid, 'admin@floorplan.studio', 'Admin12345!', 'admin'),
      ('22222222-2222-2222-2222-222222222222'::uuid, 'user@floorplan.studio',  'User12345!',  'user')
    ) as t(p_uid, p_email, p_pw, p_role)
  loop
    -- 1) auth user, already confirmed so no email code is needed.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      v_inst, r.p_uid, 'authenticated', 'authenticated',
      r.p_email, crypt(r.p_pw, gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}', '{}'
    )
    on conflict (id) do update
      set encrypted_password = crypt(r.p_pw, gen_salt('bf')),
          email               = r.p_email,
          email_confirmed_at  = now(),
          updated_at          = now();

    -- 2) Identity row. GoTrue resolves the login identity from here, so
    --    without it a correct password still fails as "Invalid login
    --    credentials". Replaced each run so re-running cannot duplicate.
    delete from auth.identities where user_id = r.p_uid and provider = 'email';
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), r.p_uid, r.p_uid,
      format('{"sub":"%s","email":"%s","email_verified":true,"phone_verified":false}',
             r.p_uid::text, r.p_email)::jsonb,
      'email', now(), now(), now()
    );

    -- 3) Profile + role.
    insert into public.user_profiles (user_id, role, username, display_name)
    values (r.p_uid, r.p_role, split_part(r.p_email,'@',1), split_part(r.p_email,'@',1))
    on conflict (user_id) do update set role = r.p_role;
  end loop;

  raise notice 'Created admin % and user %', 'admin@floorplan.studio', 'user@floorplan.studio';
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 4 — VERIFY. Expect exactly two rows: admin + user, both confirmed.
-- ═════════════════════════════════════════════════════════════════════════════
select
  u.email,
  p.role,
  (u.email_confirmed_at is not null) as confirmed,
  (select count(*) from auth.identities i where i.user_id = u.id) as identities
from auth.users u
left join public.user_profiles p on p.user_id = u.id
order by p.role desc;

-- ═════════════════════════════════════════════════════════════════════════════
-- AFTER SIGNING IN
--   • The Admin button is hidden until refreshRole() runs, which only happens
--     on sign-in. Sign out, sign back in, then hard-refresh (Ctrl+Shift+R).
--   • You are reading public/index.html, the BUILT file. A cached build hides
--     the new Admin panel even when the role is correct.
--   • Uncommitted admin work lives in index.html only; see git status.
-- ═════════════════════════════════════════════════════════════════════════════
