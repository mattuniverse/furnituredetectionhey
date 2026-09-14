-- ─────────────────────────────────────────────────────────────
-- DEMO ACCOUNT + SAMPLE PROJECT  (replaces the old demo account)
-- Run once in the Supabase SQL editor (Project → SQL Editor).
-- Safe to re-run: it replaces the old demo and upserts the new one.
--
--   Demo login (use these in the app):
--     email:    user@floorplan.studio
--     password: userfloorplan
--
--   This account is a STANDARD 'user' (role = user), so it sees the normal
--   app view — not the Admin panel. If you publish a template from this
--   account it will NOT carry the "Official" badge.
--
--   What happened to the old demo account?
--     demo@floorplan.studio (which was an admin) is DELETED, along with its
--     profile row and its sample projects (cascade).
--
--   To test admin features (Admin panel, moderation, Official badge),
--   promote ONE of your own accounts to admin after running this file:
--     insert into public.user_profiles (user_id, role)
--     values ('REPLACE_WITH_YOUR_USER_UUID', 'admin')
--     on conflict (user_id) do update set role = 'admin';
--   Find your uuid: select id, email from auth.users;
--   Then sign the app out and back in to refresh the role.
-- ─────────────────────────────────────────────────────────────

do $$
declare
  old_demo_email text := 'demo@floorplan.studio';
  demo_id uuid := '00000000-0000-0000-0000-000000000002';
  demo_email text := 'user@floorplan.studio';
  demo_pass text := 'userfloorplan';
begin

  -- 0) Remove the OLD demo account (email + its auth id), if it still exists.
  --    Its profile, projects, and universe rows are removed via cascade.
  delete from auth.identities
    where user_id in (select id from auth.users where email = old_demo_email);
  delete from auth.users
    where email = old_demo_email;

  -- 1) Auth user (so sign-in with email/password actually works).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', demo_id, 'authenticated', 'authenticated',
    demo_email, crypt(demo_pass, gen_salt('bf')),
    now(), now(), now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}'
  )
  on conflict (id) do update
    set encrypted_password = crypt(demo_pass, gen_salt('bf')),
        email_confirmed_at = auth.users.email_confirmed_at,
        updated_at = now();

  -- 2) Identity row (required by GoTrue for email sign-in).
  delete from auth.identities
    where user_id = demo_id and provider = 'email';
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), demo_id, demo_id,
    format('{"sub":"%s","email":"%s","email_verified":true,"phone_verified":false}', demo_id::text, demo_email)::jsonb,
    'email', now(), now(), now()
  );

  -- 3) Profile row — STANDARD USER (not an admin) with a public feed identity.
  --    The username/display fields power the Universe feed cards.
  insert into public.user_profiles (user_id, role, username, display_name, avatar_url)
  values (demo_id, 'user', 'RoomAI Demo', 'RoomAI Demo User', '')
  on conflict (user_id) do update
    set role = 'user',
        username = coalesce(public.user_profiles.username, 'RoomAI Demo'),
        display_name = coalesce(public.user_profiles.display_name, 'RoomAI Demo User'),
        avatar_url = coalesce(public.user_profiles.avatar_url, '');

  -- 4) Sample project so the dashboard/editor have something to show.
  insert into public.projects (user_id, name, data)
  select demo_id, 'Demo Living Room', $DEMO${
    "roomConfig": {
      "type": "Living Room", "shape": "rect",
      "w": 6, "h": 5, "wallH": 2.7, "wallT": 0.15,
      "floor": { "style": "wood", "color": "#c8a878" }
    },
    "walls": [
      { "id": 1, "x1": 0, "y1": 0, "x2": 6, "y2": 0,   "t": 0.15, "wh": 2.7, "label": "North" },
      { "id": 2, "x1": 6, "y1": 0, "x2": 6, "y2": 5,   "t": 0.15, "wh": 2.7, "label": "East" },
      { "id": 3, "x1": 6, "y1": 5, "x2": 0, "y2": 5,   "t": 0.15, "wh": 2.7, "label": "South" },
      { "id": 4, "x1": 0, "y1": 5, "x2": 0, "y2": 0,   "t": 0.15, "wh": 2.7, "label": "West" }
    ],
    "furniture": [
      { "id": 5,  "defId": "rug",     "x": 1.7, "y": 1.6,  "w": 2.0, "h": 1.4, "rot": 0,            "h3d": 0.02 },
      { "id": 6,  "defId": "sofa_3",  "x": 0.4, "y": 1.9,  "w": 2.2, "h": 0.85, "rot": 0,           "h3d": 0.8 },
      { "id": 7,  "defId": "coffee",  "x": 2.1, "y": 2.3,  "w": 1.0, "h": 0.5,  "rot": 0,           "h3d": 0.4 },
      { "id": 8,  "defId": "tv",      "x": 4.6, "y": 2.3,  "w": 1.4, "h": 0.4,  "rot": 0,           "h3d": 0.5 },
      { "id": 9,  "defId": "chair",   "x": 0.5, "y": 3.6,  "w": 0.6, "h": 0.6,  "rot": 0,           "h3d": 0.9 },
      { "id": 10, "defId": "plant",   "x": 5.3, "y": 0.5,  "w": 0.5, "h": 0.5,  "rot": 0,           "h3d": 1.2 },
      { "id": 11, "defId": "window",  "x": 2.4, "y": -0.05, "w": 1.2, "h": 0.1, "rot": 0,           "h3d": 1.2, "curtain": "heavy" },
      { "id": 12, "defId": "door",    "x": 0.075, "y": 2.55, "w": 0.9, "h": 0.15, "rot": 1.5707963, "h3d": 2.1 }
    ],
    "photos": []
  }$DEMO$::jsonb
  where not exists (select 1 from public.projects where user_id = demo_id);

  raise notice 'Demo account ready: % (standard user)', demo_email;
end $$;