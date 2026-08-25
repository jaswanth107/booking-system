# Deploying (Render + Vercel)

Backend → Render (needs a persistent disk for the SQLite file — not serverless-friendly).
Frontend → Vercel (static Vite build).

Everything code-side is already prepared: `render.yaml` (backend Blueprint), `frontend/vercel.json`
(SPA routing), configurable `CORS_ORIGIN` (backend) and `VITE_API_BASE_URL` (frontend), and the
backend auto-seeds its 4 demo rooms on first boot. The steps below need your own GitHub/Render/
Vercel accounts — I can't complete OAuth logins on your behalf.

## 1. Push to GitHub

```bash
# Create an empty repo at github.com/new first, then:
git remote add origin https://github.com/<you>/booking-system.git
git push -u origin master
```

## 2. Backend → Render

`render.yaml` is set to the **free** plan — no card required, no persistent disk. That means
booking/user data resets whenever the instance restarts, redeploys, or spins down from 15 min
of inactivity (free instances sleep when idle). Fine for a demo; upgrade to `starter` + add a
`disk:` block in `render.yaml` later if you need real persistence.

1. Go to https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect your GitHub account and select this repo. Render reads `render.yaml` automatically —
   confirm the preview shows **Environment: Node**, **Plan: Free**.
3. Click **Apply**. Wait for the build (`npm install && npm run build`) and deploy to finish.
4. Copy the resulting URL, e.g. `https://booking-backend.onrender.com`.
5. Sanity check: `curl https://booking-backend.onrender.com/api/health` → `{"ok":true}`.

## 3. Frontend → Vercel

Either the dashboard or the CLI works.

**CLI** (from `frontend/`):
```bash
npx vercel login          # interactive — run this yourself in a real terminal
npx vercel --prod
```
When prompted for environment variables (or afterward in the Vercel dashboard → Project →
Settings → Environment Variables), set:
```
VITE_API_BASE_URL = https://booking-backend.onrender.com/api
```
(use the real Render URL from step 2, and redeploy after adding the env var — Vite bakes it in
at build time, so it won't take effect until the next build).

**Dashboard**: https://vercel.com/new → import the GitHub repo → set **Root Directory** to
`frontend` → add the `VITE_API_BASE_URL` env var above → Deploy.

Copy the resulting URL, e.g. `https://booking-system.vercel.app`.

## 4. Lock down CORS

Back in the Render service → **Environment** → set:
```
CORS_ORIGIN = https://booking-system.vercel.app
```
(comma-separate multiple origins if needed). Save — Render redeploys automatically.

## 5. Verify

Open the Vercel URL, sign up a fresh account, book a room, confirm it shows up in "My Bookings".

## Notes

- The Render free tier's cold start (after idling) can take 30-60s for the first request —
  don't mistake that for a bug if the first sign-up/login feels slow.
- On the free plan, `DB_PATH` is unset and defaults to a file next to the built app
  (ephemeral — see the note in `render.yaml`). Every redeploy/restart/spin-down means everyone
  has to sign up again and rebooking from scratch. That's expected on free, not a bug.
- Nothing in this repo talks to a third-party auth provider — signup/login is fully self-hosted
  (see README.md "Authentication").
