# FloorPlan Studio — deployment guide

## If you're getting a 404 on Vercel, read this first

A 404 on the deployed URL almost always means Vercel deployed the repo but couldn't find
`index.html` at the root it's serving from. The #1 cause is **an extra nested folder** —
e.g. if this whole folder got committed as `floorplan-studio/index.html` instead of
`index.html` sitting directly at the repo root.

Fix it one of two ways:
- **Easiest:** make sure `index.html`, `vercel.json`, etc. are directly inside your
  GitHub repo's root (not inside a subfolder). Re-push if needed.
- **Or:** if you do want them in a subfolder, go to your Vercel project →
  **Settings → General → Root Directory** and set it to that subfolder's path, then redeploy.

Also double check in **Settings → Build & Development Settings** that "Output Directory"
and "Build Command" are left as their defaults/empty (this project has no build step —
Framework Preset should be **Other**).

This project ships a `vercel.json` (explicit config, no guessing needed) — make sure it's
in the same root folder as `index.html`.

This folder is the "online" version of your app:

```
/
├── index.html            ← the whole frontend (canvas editor, 3D view, auth, save/load)
├── api/
│   ├── detect-furniture.js ← Claude vision detection (serverless)
│   ├── architect.js        ← AI Architect chat (serverless)
│   └── suggest-layout.js   ← AI room suggestions (serverless)
├── shared/
│   └── rules.js          ← furniture defs + layout rules (injected at build)
├── supabase/
│   └── schema.sql         ← run once in Supabase to create the projects table + admin
├── package.json
├── build.js              ← generates public/index.html with shared rules + env injected
├── vercel.json
└── .gitignore
```

No build step, no framework — Vercel serves `index.html` as a static file and runs the
serverless function `api/detect-furniture.js`, which sends room photos to the **Anthropic
Claude vision API** for furniture detection (see sections 3 and 4).

## 1. GitHub

```bash
cd floorplan-studio          # this folder
git init
git add .
git commit -m "Initial online version"
# create the repo on github.com, then:
git remote add origin <url> && git push -u origin main
```

## 2. Supabase (database + auth + admin)

1. Go to [supabase.com](https://supabase.com) → New project. Save the database password somewhere.
2. Once it's provisioned, go to **SQL Editor → New query**, paste the contents of
   `supabase/schema.sql`, and run it. This creates:
   - the `projects` table with Row Level Security so each signed-in user only sees their own rows,
   - the `room-images` Storage bucket with its own RLS policies,
   - the **admin system**: `user_profiles` table (`user`/`admin` roles), the `is_admin()`
     helper, admin-only `admin_list_users()` / `admin_list_projects()` functions, and widened
     policies so admins can view/delete any project or photo.
   **Already have a Supabase project from before?** Just re-run the (updated) `schema.sql` —
   the statements are `if not exists` / re-runnable, so it's safe to re-run.
3. Go to **Settings → API**. Copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **anon public** key → this is `SUPABASE_ANON_KEY`
4. Open `index.html` and paste both into these two lines near the top of the `<script>` block:
   ```js
   const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
   ```
   The anon key is meant to be public — it only grants what your RLS policies allow.
5. **Grant yourself admin** (once the schema above is run):
   ```sql
   select id, email from auth.users;            -- find your uuid
   insert into public.user_profiles (user_id, role)
   values ('YOUR_UUID', 'admin')
   on conflict (user_id) do update set role = 'admin';
   ```
   After that, an **Admin** button appears in the dashboard.
6. (Recommended for testing) Go to **Authentication → Providers → Email** and turn off
   "Confirm email" temporarily, so you can sign up and sign in immediately without checking
   an inbox. Turn it back on before sharing the site with real users.

## 3. AI furniture detection (Claude, serverless)

Furniture detection no longer uses an ONNX service on Render. Room photos are sent by the
Vercel serverless function `api/detect-furniture.js` to the **Anthropic Claude vision API**
(`claude-haiku-4-5-20251001` by default), which returns the furniture/fixture detections.
There is no separate backend to deploy — Vercel runs the function for you.

1. Add your Anthropic API key as a Vercel environment variable: `ANTHROPIC_API_KEY`.
2. (Optional) Override the model with `MODEL_NAME` (default is `claude-haiku-4-5-20251001`).
3. The frontend calls the function through the `vercel.json` rewrite: `/api/detect-furniture`
   → `api/detect-furniture.js`. The response shape is unchanged, so existing client code
   keeps working.
4. If a key isn't set, `/api/detect-furniture` returns a clear "ANTHROPIC_API_KEY is not set"
   error, and the "Scan Furniture" flow reports the detection failure.

## 4. Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub repo
   you just pushed.
2. Framework preset: **Other**.
3. **Build settings** (Project → Settings → General):
   - Build Command: `npm run build`
   - Output Directory: `public`
   - Root Directory: `.` (default)
4. **Environment variables** (Project → Settings → Environment Variables) — required for
   cloud features, but any that are unset fall back to the defaults baked into `index.html`:

   | Name              | Example                                          |
   | ----------------- | ------------------------------------------------ |
   | `SUPABASE_URL`    | `https://binubqetpsugdnwtarvt.supabase.co`        |
   | `SUPABASE_ANON_KEY` | `sb_publishable_...`                            |
   | `ANTHROPIC_API_KEY` | `sk-ant-...`                                   |
   | `MODEL_NAME`      | `claude-haiku-4-5-20251001` (optional)           |

   `build.js` replaces the `__NAME__`/token placeholders in `index.html` with these values at
   build time; with none set, the built site still works using the hardcoded defaults.
5. Deploy. Vercel gives you a `*.vercel.app` URL.
6. Every future `git push` to `main` auto-redeploys (rebuild + redeploy).

## 5. Test end-to-end

1. Open the deployed URL → **Create Account** → sign up with an email/password.
2. Create a new room, add some furniture, hit **Save** (💾 in the editor topbar) — it should
   say "Project saved ✓". Go back to the dashboard — you should see the project card.
3. In the room-setup photo modal, upload a real room photo and hit **Scan Furniture** →
   confirms detection against the Claude API works.
4. Log out, log back in — your projects should still be there (they're in Supabase now, not
   just in-memory).

## Process flow

```
Login/Register → Supabase Auth → Dashboard → Create Project
   → Upload Room Photos → Supabase Storage (room-images bucket)
   → AI Furniture Detection (Anthropic Claude vision API, via Vercel serverless function)
   → Interactive Object Verification (review/uncheck/relabel each detection)
   → Room Measurements + reference width (used to scale detections onto the plan)
   → Generate Editable 2D Floor Plan → Drag/Resize/Rotate Furniture
   → Flooring + window/curtain styling → Generate 3D Room Visualization (Three.js)
   → Save Project (Supabase PostgreSQL) → Export PDF / PNG / JSON
```

## Notes / limitations

- **Furniture class mapping is best-effort.** The Claude model's labels are mapped to this
  app's furniture ids inside `api/detect-furniture.js` (`labelToFurnitureId`). Items it
  can't map to a known id come back under `unmappedClasses` — extend that map if needed.
- **Placement is approximate.** A single 2D photo doesn't give true top-down coordinates —
  detections are mapped onto the room footprint using the wall reference width. Expect to
  drag items into their correct spot after confirming them in the verification step.
- **Claude costs apply.** Every scan calls the Anthropic API; watch usage on large uploads.