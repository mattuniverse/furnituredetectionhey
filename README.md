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
├── supabase/
│   └── schema.sql         ← run once in Supabase to create the projects table + admin
├── package.json
├── vercel.json
└── .gitignore
```

No build step, no framework, no serverless functions — Vercel serves `index.html` as a
static file. Furniture detection is handled by a **separate ONNX service on Render**
(see section 3), which the frontend calls directly via its public URL.

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

## 3. Render (AI furniture detection backend)

The frontend detects furniture by calling a FastAPI + ONNX service. That service lives in
a **separate repo** so the model binary (`best.onnx`) is baked in and isn't part of the
frontend deploy.

1. On [render.com](https://render.com) → **New → Web Service**, import that repo
   (e.g. `mattuniverse/rendereed_floorplan`).
2. It ships a `Dockerfile` + `render.yaml`, so Render will build and run it as-is.
3. Render gives a URL like `https://rendereed-floorplan.onrender.com`.
4. The frontend already points at it by default — in `index.html`:
   ```js
   const DETECT_API_BASE = window.FLOORPLAN_API_BASE || 'https://rendereed-floorplan.onrender.com';
   ```
   Change the default value if your Render URL differs, or override it at runtime with
   `window.FLOORPLAN_API_BASE` before the script runs.
5. **CORS** is enabled for all origins by default, so your Vercel domain can call it.
   To lock it down, set an env var on the Render service:
   ```
   ALLOWED_ORIGINS=https://your-app.vercel.app
   ```
6. Health check: open `https://<your-render-url>/` — you should see
   `{"status":"ok","model":"best.onnx","runtime":"onnxruntime"}`.

## 4. Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub repo
   you just pushed.
2. Framework preset: choose **Other** (no build step — it's a static site).
3. No environment variables are required — the Supabase keys are in `index.html` and the
   detection URL is the Render default above.
4. Deploy. Vercel gives you a `*.vercel.app` URL.
5. Every future `git push` to `main` auto-redeploys.

## 5. Test end-to-end

1. Open the deployed URL → **Create Account** → sign up with an email/password.
2. Create a new room, add some furniture, hit **Save** (💾 in the editor topbar) — it should
   say "Project saved ✓". Go back to the dashboard — you should see the project card.
3. In the room-setup photo modal, upload a real room photo and hit **Scan Furniture** →
   confirms detection against the Render service works.
4. Log out, log back in — your projects should still be there (they're in Supabase now, not
   just in-memory).

## Process flow

```
Login/Register → Supabase Auth → Dashboard → Create Project
   → Upload Room Photos → Supabase Storage (room-images bucket)
   → AI Furniture Detection (Render ONNX service, direct API call)
   → Interactive Object Verification (review/uncheck/relabel each detection)
   → Room Measurements + reference width (used to scale detections onto the plan)
   → Generate Editable 2D Floor Plan → Drag/Resize/Rotate Furniture
   → Flooring + window/curtain styling → Generate 3D Room Visualization (Three.js)
   → Save Project (Supabase PostgreSQL) → Export PDF / PNG / JSON
```

## Notes / limitations

- **Furniture class mapping is best-effort.** The model's class names are mapped to this
  app's furniture ids inside the Render service's `app.py` (`_DEFAULT_CLASS_MAP`). If
  detections come back with `unmappedClasses`, extend that map.
- **Placement is approximate.** A single 2D photo doesn't give true top-down coordinates —
  detections are mapped onto the room footprint using the wall reference width. Expect to
  drag items into their correct spot after confirming them in the verification step.
- **Render free tier cold-starts.** The first request after the service idles can take
  ~30–60s. Subsequent calls are fast.