# GitHub Actions Setup Guide — Chhath Radio

## First — Enable GitHub Actions on your repo

GitHub Actions is already configured in this project (the `.github/workflows/`
folder contains the pipeline files). You just need to make sure it's enabled:

1. Go to your GitHub repo: `https://github.com/paras97verma/chhath-radio-player`
2. Click the **Actions** tab (top navigation bar)
3. If you see a yellow banner saying "Workflows aren't being run on this forked
   repository" or "Actions are disabled", click **Enable GitHub Actions** or
   **I understand my workflows, go ahead and enable them**
4. You should now see three workflows listed on the left:
   - **Backend CI/CD** (from `.github/workflows/backend.yml`)
   - **Frontend CI/CD** (from `.github/workflows/frontend.yml`)
   - **Database Operations** (from `.github/workflows/db.yml`)

That's it — Actions is now active. The workflows run automatically on every push
to `main`. No other configuration needed to enable them.

---


This guide walks you through setting up all the secrets that GitHub Actions needs
to automatically deploy your backend (Render), frontend (Vercel), and database
(Supabase) every time you push to `main`.

---

## How the pipelines work

```
Push to main (backend/** files changed)
  └── GitHub Actions: backend.yml
        1. Runs pytest (with real Postgres + Redis in CI)
        2. Updates env vars on Render via API
        3. Triggers Render deploy hook → Render builds & deploys Docker image
        4. Polls /api/health until backend is live

Push to main (frontend/** files changed)
  └── GitHub Actions: frontend.yml
        1. Runs vitest unit tests
        2. Builds production Docker image (smoke test)
        3. Runs: vercel build --prod (injects NEXT_PUBLIC_* from secrets)
        4. Runs: vercel deploy --prebuilt --prod
        5. Verifies site is live

Manual trigger (GitHub UI)
  └── GitHub Actions: db.yml
        → migrate / seed-admin / seed-songs / rollback / status
```

**Key point**: GitHub Actions reads secrets from your repo's secret store and
injects them into the build. You never put secrets in code or Vercel's dashboard.

---

## Step 1 — Collect all the values you need

Before touching GitHub, gather these values. Each section below tells you where
to find them.

### 1a. Supabase (DATABASE_URL)

1. Go to https://supabase.com → sign in → open your project
2. Left sidebar → **Settings** → **Database**
3. Scroll to **Connection Pooling** section
4. Copy the **Connection string** (URI format, port **6543**)
5. It looks like:
   ```
   postgresql://postgres.abcdef:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
   ```
6. Replace `[YOUR-PASSWORD]` with your actual database password

### 1b. Upstash (REDIS_URL)

1. Go to https://console.upstash.com → sign in → open your database
2. Click **Details** tab
3. Scroll to **Connect** section
4. Copy the **UPSTASH_REDIS_URL** value
5. It looks like:
   ```
   rediss://default:abc123@global-xyz.upstash.io:6379
   ```

### 1c. Secret key (SECRET_KEY)

Generate a random 64-character hex string. Run this in your terminal:
```bash
openssl rand -hex 32
```
Copy the output — that's your SECRET_KEY.

### 1d. Admin credentials

Choose an email and a strong password (min 12 chars) for the admin panel at
`/admin`. These are stored in the database, not in code.

### 1e. VAPID keys (for push notifications)

Run this in your terminal from the project root:
```bash
cd frontend && node -e "const wp=require('./node_modules/web-push'); const k=wp.generateVAPIDKeys(); console.log('Public:', k.publicKey); console.log('Private:', k.privateKey);"
```

If that fails, go to https://vapidkeys.com and click **Generate** — copy both keys.

### 1f. Render (backend hosting)

**Deploy Hook URL:**
1. Go to https://dashboard.render.com → open your `chhath-radio-api` service
2. Click **Settings** tab
3. Scroll to **Deploy Hook** → copy the URL
4. It looks like: `https://api.render.com/deploy/srv-abc123?key=xyz`

**API Key:**
1. Go to https://dashboard.render.com/u/settings (top-right avatar → Account Settings)
2. Click **API Keys** → **Create API Key** → copy it

**Service ID:**
1. Open your Render service in the dashboard
2. Look at the URL in your browser: `https://dashboard.render.com/web/srv-XXXXXXXX`
3. Copy the `srv-XXXXXXXX` part

**Health Check Path (IMPORTANT — do this in Render dashboard):**
1. Open your Render service → **Settings** tab
2. Scroll to **Health Check Path**
3. Set it to: `/api/health`
4. Click **Save Changes**

**Backend public URL:**
- It looks like: `https://chhath-radio-api.onrender.com`
- Find it on your Render service dashboard (the URL shown at the top)

### 1g. Vercel (frontend hosting)

**Token:**
1. Go to https://vercel.com/account/tokens
2. Click **Create** → give it a name → copy the token

**Org ID + Project ID:**
1. In your terminal, from the project root:
   ```bash
   cd frontend && npx vercel link
   ```
2. Follow the prompts to link to your Vercel project
3. This creates `frontend/.vercel/project.json` — open it:
   ```json
   { "orgId": "team_xxx", "projectId": "prj_xxx" }
   ```
4. Copy both values

**Frontend public URL:**
- It looks like: `https://chhathradio.vercel.app`
- Find it in your Vercel project dashboard

---

## Step 2 — Add secrets to GitHub

1. Go to your GitHub repo: `https://github.com/paras97verma/chhath-radio-player`
2. Click **Settings** (top tab)
3. Left sidebar → **Secrets and variables** → **Actions**
4. Click **New repository secret** for each secret below

Add ALL of these secrets (name must match exactly):

| Secret Name | Value | Where from |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.xxx:pass@...supabase.com:6543/postgres` | Supabase → Settings → Database → Connection Pooling |
| `REDIS_URL` | `rediss://default:xxx@global-xxx.upstash.io:6379` | Upstash → Database → Details → Connect |
| `SECRET_KEY` | 64-char hex string | `openssl rand -hex 32` |
| `ADMIN_EMAIL` | your-admin@email.com | Your choice |
| `ADMIN_PASSWORD` | your-strong-password | Your choice (min 12 chars) |
| `VAPID_PUBLIC_KEY` | `BXxx...` (starts with B) | Generated in Step 1e |
| `VAPID_PRIVATE_KEY` | `xxx...` | Generated in Step 1e |
| `RENDER_API_KEY` | `rnd_xxx...` | Render → Account Settings → API Keys |
| `RENDER_SERVICE_ID` | `srv-xxx...` | Render dashboard URL |
| `RENDER_DEPLOY_HOOK_URL` | `https://api.render.com/deploy/srv-xxx?key=yyy` | Render → Service → Settings → Deploy Hook |
| `NEXT_PUBLIC_API_URL` | `https://chhath-radio-api.onrender.com` | Your Render service URL |
| `NEXT_PUBLIC_SITE_URL` | `https://chhathradio.vercel.app` | Your Vercel project URL |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same as `VAPID_PUBLIC_KEY` | Same as above |
| `VERCEL_TOKEN` | `xxx...` | Vercel → Account → Tokens |
| `VERCEL_ORG_ID` | `team_xxx` or `user_xxx` | `frontend/.vercel/project.json` |
| `VERCEL_PROJECT_ID` | `prj_xxx` | `frontend/.vercel/project.json` |

---

## Step 3 — Set Render environment variables manually (first time only)

The GitHub Actions pipeline updates Render env vars on every deploy, but for the
**first deploy** you need to set them manually so Render can start the service.

1. Go to your Render service → **Environment** tab
2. Add these key-value pairs:

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Supabase URL |
| `REDIS_URL` | Your Upstash URL |
| `SECRET_KEY` | Your generated secret key |
| `ADMIN_EMAIL` | Your admin email |
| `ADMIN_PASSWORD` | Your admin password |
| `VAPID_PUBLIC_KEY` | Your VAPID public key |
| `VAPID_PRIVATE_KEY` | Your VAPID private key |
| `ALGORITHM` | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` |
| `WEB_CONCURRENCY` | `1` |
| `LOG_LEVEL` | `info` |

3. Click **Save Changes** → Render will redeploy automatically

---

## Step 4 — Trigger your first deployment

Once all secrets are set in GitHub:

### Option A: Push a small change to trigger the pipeline

```bash
# Make a trivial change to trigger backend pipeline
echo "# deployed" >> backend/README.md
git add backend/README.md
git commit -m "chore: trigger first CI deploy"
git push origin main
```

This will trigger `backend.yml` because `backend/**` changed.

For the frontend pipeline, touch a frontend file:
```bash
echo "# deployed" >> frontend/README.md
git add frontend/README.md
git commit -m "chore: trigger first frontend deploy"
git push origin main
```

### Option B: Trigger manually from GitHub UI

1. Go to your repo → **Actions** tab
2. Click **Backend CI/CD** in the left sidebar
3. Click **Run workflow** → **Run workflow** (green button)
4. Do the same for **Frontend CI/CD**

---

## Step 5 — Seed the database

After the backend is deployed and healthy:

1. Go to your repo → **Actions** tab
2. Click **Database Operations** in the left sidebar
3. Click **Run workflow**
4. Select operation: `seed-admin` → click **Run workflow**
5. Wait for it to complete (creates your admin user)
6. Optionally run `seed-songs` to add songs to the queue

---

## Step 6 — Verify everything works

1. Visit your backend health check: `https://chhath-radio-api.onrender.com/api/health`
   - Should return: `{"status": "ok", ...}`

2. Visit your frontend: `https://chhathradio.vercel.app`
   - Should show the Chhath Radio player

3. Visit the admin panel: `https://chhathradio.vercel.app/admin`
   - Log in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`

---

## How future deployments work (automatic)

Once set up, every `git push origin main` automatically:

- If `backend/**` changed → runs tests → deploys to Render → waits for health check
- If `frontend/**` changed → runs tests → builds → deploys to Vercel → verifies live
- Database operations are always manual (safety measure)

You never need to touch Render or Vercel dashboards again for deployments.

---

## Troubleshooting

### "Secrets not found" in GitHub Actions logs

The pipeline shows `***` for secret values — that's correct (masked). If a step
fails saying a secret is empty, double-check the secret name matches exactly
(case-sensitive) in GitHub → Settings → Secrets.

### Render deploy succeeds but health check times out

- Check Render logs: Service → **Logs** tab
- Common causes: wrong `DATABASE_URL`, migration failed, `SECRET_KEY` too short
- Make sure **Health Check Path** is set to `/api/health` in Render Settings

### Vercel build fails with environment variable errors

- The `NEXT_PUBLIC_*` secrets must be set in GitHub (not Vercel dashboard)
- GitHub Actions injects them at build time via `vercel build --prod`
- Check: GitHub → Settings → Secrets → confirm `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` are all set

### Frontend shows "Cannot connect to backend"

- Verify `NEXT_PUBLIC_API_URL` secret points to your actual Render URL
- Verify the Render backend is healthy at `/api/health`
- Check CORS: the backend must allow your Vercel domain in `CORS_ORIGINS`
  (set `CORS_ORIGINS=https://chhathradio.vercel.app` in Render env vars)