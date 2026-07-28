# FloorPlan Studio — deployment guide

## If you're getting a 404 on Vercel, read this first

A 404 on the deployed URL almost always means Vercel deployed the repo but couldn't find
`index.html` at the root it's serving from. The #1 cause is **an extra nested folder** —
e.g. if this whole folder got committed as `floorplan-studio/index.html` instead of
`index.html` sitting directly at the repo root.

Fix it one of two ways:
- **Easiest:** make sure `index.html`, `api/`, `vercel.json`, etc. are directly inside your
  GitHub repo's root (not inside a subfolder). Re-push if needed.
- **Or:** if you do want them in a subfolder, go to your Vercel project →
  **Settings → General → Root Directory** and set it to that subfolder's path, then redeploy.

Also double check in **Settings → Build & Development Settings** that "Output Directory"
and "Build Command" are left as their defaults/empty (this project has no build step —
Framework Preset should be **Other**).

This project now also ships a `vercel.json` (explicit config, no guessing needed) — make
sure it's in the same root folder as `index.html`.

This folder is the "online" version of your app:

```
/
├── index.html            ← the whole frontend (canvas editor, 3D view, auth, save/load)
├── api/
│   ├── detect-furniture.js   ← Vercel serverless function, proxies to Roboflow
│   └── lib/
│       ├── roboflowClient.js
│       ├── extractPredictions.js
│       └── furnitureMap.js
├── supabase/
│   └── schema.sql         ← run once in Supabase to create the projects table
├── package.json
└── .gitignore
```

No build step, no framework — Vercel serves `index.html` as a static file and turns
everything under `/api` into a serverless function automatically.

## 1. GitHub

```bash
cd floorplan-studio          # this folder
git init
git add .
git commit -m "Initial online version"
gh repo create floorplan-studio --public --source=. --push
# (or create the repo on github.com first, then: git remote add origin <url> && git push -u origin main)
```

## 2. Supabase (database + auth)

1. Go to [supabase.com](https://supabase.com) → New project. Save the database password somewhere.
2. Once it's provisioned, go to **SQL Editor → New query**, paste the contents of
   `supabase/schema.sql`, and run it. This creates the `projects` table with Row Level
   Security so each signed-in user can only see their own rows, and now also creates a
   `room-images` Storage bucket with its own RLS policies.
   **Already have a Supabase project from before?** Just re-run the (updated) `schema.sql`
   again — the `projects` table statements are `if not exists` / no-op on conflict, so it's
   safe to re-run and it'll add the new storage bucket + policies without touching your data.
3. Go to **Settings → API**. Copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **anon public** key → this is `SUPABASE_ANON_KEY`
4. Open `index.html` and paste both into these two lines near the top of the `<script>` block:
   ```js
   const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
   ```
   The anon key is meant to be public — it only grants what your RLS policies allow.
5. (Recommended for testing) Go to **Authentication → Providers → Email** and turn off
   "Confirm email" temporarily, so you can sign up and sign in immediately without checking
   an inbox. Turn it back on before sharing the site with real users.

## 3. Roboflow

Nothing changes here — you're reusing the same workflow. You'll just move the API key from
a local `.env` file into Vercel's environment variables instead (next step), so it's never
sent to the browser.

## 4. Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub repo
   you just pushed.
2. Framework preset: choose **Other** (there's no framework here — it's static + functions).
3. Before deploying, add these **Environment Variables** (Project Settings → Environment
   Variables):

   | Name | Value |
   |---|---|
   | `ROBOFLOW_API_KEY` | from app.roboflow.com/settings/api |
   | `ROBOFLOW_API_URL` | `https://serverless.roboflow.com` (default, only set if different) |
   | `ROBOFLOW_WORKSPACE_NAME` | `tinnns-workspace` (or your workspace) |
   | `ROBOFLOW_WORKFLOW_ID` | `furniture-vfurniture-q5tkw-hv0i3-1-yolo11n-t1-logic` (or your workflow id) |

4. Deploy. Vercel gives you a `*.vercel.app` URL.
5. Every future `git push` to `main` auto-redeploys.

## 5. Test end-to-end

1. Open the deployed URL → **Create Account** → sign up with an email/password.
2. Create a new room, add some furniture, hit **Save** (💾 in the editor topbar) — it should
   say "Project saved ✓". Go back to the dashboard — you should see the project card.
3. In the room-setup photo modal, upload a real room photo and hit **Scan Furniture** →
   confirms the Roboflow proxy through `/api/detect-furniture` works.
4. Log out, log back in — your projects should still be there (they're in Supabase now, not
   just in-memory).

## Process flow (now matches the documented architecture)

```
Login/Register → Supabase Auth → Dashboard → Create Project
   → Upload Room Photos → Supabase Storage (room-images bucket)
   → AI Furniture Detection (Roboflow, proxied through /api/detect-furniture)
   → Interactive Object Verification (review/uncheck/relabel each detection)
   → Room Measurements (entered at room setup, used to scale detections onto the plan)
   → Generate Editable 2D Floor Plan → Drag/Resize/Rotate Furniture
   → Generate 3D Room Visualization (Three.js)
   → Save Project (Supabase PostgreSQL) → Export PDF / PNG / JSON
```

Three things that were previously missing/skipped have been added so the app actually
follows every step above:

1. **Interactive Object Verification.** Scanning no longer auto-places furniture. It opens a
   review modal (checkbox to include/exclude each detection, dropdown to fix a wrong class,
   confidence % shown) — only confirmed items get placed on the floor plan.
2. **Supabase Storage for room photos.** Each uploaded wall photo is now uploaded to a
   `room-images` bucket (see the new section at the bottom of `supabase/schema.sql` — run
   that once, it creates the bucket + RLS policies). The project's `photos` array (path +
   public URL) is saved alongside the project row, so it's a reference, not a duplicate copy.
3. **Export PDF / PNG / JSON.** New export (⭳) button in the editor topbar exports the 2D
   floor plan as a PNG, a one-page PDF (plan + furniture list), or the raw project JSON.

## Notes / limitations carried over from the original setup

- **Furniture class mapping is best-effort.** `api/lib/furnitureMap.js` maps Roboflow class
  names to this app's furniture ids based on the workflow's name, not a confirmed class list.
  If detections come back with `unmappedClasses`, add them to that file.
- **Placement is approximate.** A single 2D photo doesn't give true top-down coordinates —
  detections are mapped proportionally onto the room footprint. Expect to drag items into
  their correct spot after confirming them in the verification step.
- **Vercel serverless functions cap request bodies around 4.5MB.** The frontend already
  downscales photos to at most 1600px before sending (see `resizeImageToBase64()` in
  `index.html`), which keeps it well under that limit for normal room photos.
