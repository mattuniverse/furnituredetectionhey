-- ─────────────────────────────────────────────────────────────
-- DEMO ACCOUNT + SAMPLE PROJECT
-- Run once in the Supabase SQL editor (Project → SQL Editor).
-- Safe to re-run: it upserts, never duplicates.
--
--   Demo login (use these in the app):
--     email:    demo@floorplan.studio
--     password: DemoPass123!
--
--   The demo account is created as an ADMIN so you can see the
--   admin panel too. To test the normal user view instead, run:
--     update public.user_profiles set role = 'user'
--     where user_id = '00000000-0000-0000-0000-000000000001';
-- ─────────────────────────────────────────────────────────────

do $$
declare
  demo_id uuid := '00000000-0000-0000-0000-000000000001';
  demo_email text := 'demo@floorplan.studio';
  demo_pass text := 'DemoPass123!';
begin

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

  -- 3) Profile row + admin role (lets you open the Admin panel).
  insert into public.user_profiles (user_id, role)
  values (demo_id, 'admin')
  on conflict (user_id) do update set role = 'admin';

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
      { "id": 5,  "defId": "rug",      "x": 1.7, "y": 1.6, "w": 2.0, "h": 1.4, "rot": 0,          "h3d": 0.02 },
      { "id": 6,  "defId": "sofa_3",   "x": 0.4, "y": 1.9, "w": 2.2, "h": 0.85, "rot": 0,         "h3d": 0.8 },
      { "id": 7,  "defId": "coffee",   "x": 2.1, "y": 2.3, "w": 1.0, "h": 0.5,  "rot": 0,         "h3d": 0.4 },
      { "id": 8,  "defId": "tv",       "x": 4.6, "y": 2.3, "w": 1.4, "h": 0.4,  "rot": 0,         "h3d": 0.5 },
      { "id": 9,  "defId": "chair",    "x": 0.5, "y": 3.6, "w": 0.6, "h": 0.6,  "rot": 0,         "h3d": 0.9 },
      { "id": 10, "defId": "plant",    "x": 5.3, "y": 0.5, "w": 0.5, "h": 0.5,  "rot": 0,         "h3d": 1.2 },
      { "id": 11, "defId": "window",   "x": 2.4, "y": 0.01, "w": 1.2, "h": 0.1, "rot": 0,        "h3d": 1.2 },
      { "id": 12, "defId": "curtain",  "x": 2.1, "y": 0.01, "w": 1.8, "h": 0.15, "rot": 0,       "h3d": 2.4 },
      { "id": 13, "defId": "door",     "x": 0.01, "y": 0.6, "w": 0.9, "h": 0.15, "rot": 1.5707963, "h3d": 2.1 }
    ],
    "photos": []
  }$DEMO$::jsonb
  where not exists (select 1 from public.projects where user_id = demo_id);

  raise notice 'Demo account ready: %', demo_email;
end $$;