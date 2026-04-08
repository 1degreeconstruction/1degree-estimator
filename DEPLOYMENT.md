# Deployment Guide — 1 Degree Construction Estimator

Full deployment: Supabase (database) + Render (backend API) + Vercel (frontend).

Your Supabase project: **https://abcqkepgszirorvylzfi.supabase.co**

---

## Step 1 — Create a GitHub Repository

1. Go to **https://github.com/new**
2. Name it `1degree-estimator` (make it **Private**)
3. Do NOT initialize with README, .gitignore, or license — leave those unchecked
4. Click **Create repository**
5. Copy the repo URL (e.g. `https://github.com/YOUR-USERNAME/1degree-estimator.git`)

Then push your code from your local machine:

```bash
cd /path/to/1degree-estimator
git init
git add .
git commit -m "Initial commit — PostgreSQL migration"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/1degree-estimator.git
git push -u origin main
```

---

## Step 2 — Set Up Supabase (Database)

Your project is already created at **https://abcqkepgszirorvylzfi.supabase.co**.

### 2a. Run the SQL schema

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/abcqkepgszirorvylzfi
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the file `supabase-schema.sql` from your project folder and paste the entire contents into the editor
5. Click **Run** (green button)
6. You should see "Success. No rows returned." — this means all tables and seed data were created

### 2b. Get your database connection string

1. In the Supabase dashboard, go to **Project Settings** → **Database**
2. Scroll down to **Connection string**
3. Select the **URI** tab
4. Copy the connection string — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.abcqkepgszirorvylzfi.supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with your actual Supabase database password
   - If you forgot it: go to **Project Settings** → **Database** → scroll to **Database password** → click **Reset**
6. Save this connection string — you will need it in Steps 3 and 4

---

## Step 3 — Deploy the Backend on Render

1. Go to **https://render.com** and sign up / log in (use your GitHub account)
2. Click **New** → **Web Service**
3. Choose **Build and deploy from a Git repository**
4. Connect your GitHub account if not already connected, then select your `1degree-estimator` repo
5. Render will auto-detect the `render.yaml` file — click **Apply** to use those settings
6. If Render doesn't auto-detect it, configure manually:
   - **Name:** `1degree-estimator-api`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `NODE_ENV=production node dist/index.cjs`
   - **Plan:** Free

### 3a. Set environment variables on Render

In the Render dashboard for your service, go to **Environment** and add these variables:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(your Supabase connection string from Step 2b)* |
| `ANTHROPIC_API_KEY` | *(your Anthropic API key from console.anthropic.com)* |
| `SESSION_SECRET` | *(any long random string — click "Generate" if available)* |
| `FRONTEND_URL` | *(leave blank for now — fill in after Vercel deployment in Step 4)* |
| `GOOGLE_CLIENT_ID` | *(leave blank for now — fill in after Step 5)* |
| `GOOGLE_CLIENT_SECRET` | *(leave blank for now — fill in after Step 5)* |

7. Click **Save Changes**, then **Deploy** (or it may auto-deploy)
8. Wait 2–5 minutes for the build to complete
9. Once deployed, note your backend URL — it will look like:
   `https://1degree-estimator-api.onrender.com`

---

## Step 4 — Deploy the Frontend on Vercel

1. Go to **https://vercel.com** and sign up / log in (use your GitHub account)
2. Click **Add New** → **Project**
3. Import your `1degree-estimator` GitHub repository
4. Vercel will detect the `vercel.json` config automatically
5. **Before deploying**, update `vercel.json` in your repo:
   - Open `vercel.json` and replace `https://your-backend.onrender.com` with your actual Render URL from Step 3
   - Commit and push that change:
     ```bash
     git add vercel.json
     git commit -m "Set Render backend URL in vercel.json"
     git push
     ```
6. Click **Deploy** on Vercel
7. Wait 1–2 minutes
8. Once deployed, note your frontend URL — it will look like:
   `https://1degree-estimator.vercel.app`

### 4a. Update FRONTEND_URL on Render

Go back to Render → your service → **Environment** → update `FRONTEND_URL` with your Vercel URL → **Save Changes** → **Manual Deploy**.

---

## Step 5 — Set Up Google OAuth (for Google login)

> Skip this step if you don't need Google login yet. The app will work without it.

1. Go to **https://console.cloud.google.com**
2. Create a new project (or use an existing one)
3. Go to **APIs & Services** → **OAuth consent screen**
   - Choose **External**
   - Fill in: App name = `1 Degree Estimator`, User support email = your email
   - Add your Vercel domain to **Authorized domains**
   - Save
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `1 Degree Estimator`
   - Authorized redirect URIs — add both:
     ```
     https://1degree-estimator-api.onrender.com/auth/google/callback
     http://localhost:5000/auth/google/callback
     ```
   - Click **Create**
5. Copy the **Client ID** and **Client Secret**
6. Go back to Render → your service → **Environment** → fill in:
   - `GOOGLE_CLIENT_ID` → your Client ID
   - `GOOGLE_CLIENT_SECRET` → your Client Secret
7. Save and redeploy

---

## Step 6 — Verify Everything Works

1. Open your Vercel frontend URL in a browser
2. The dashboard should load and show an empty estimates list
3. Click **New Estimate** — create a test estimate and save it
4. If it saves successfully, your full stack is working

### Troubleshooting

**"Cannot connect to database"** — Double-check `DATABASE_URL` on Render. Make sure the password is correct and there are no extra spaces.

**Frontend loads but API calls fail** — Check that `vercel.json` has the correct Render URL. Check Render logs for errors.

**Build fails on Render** — Check the build logs. Most common cause: missing environment variable. Make sure `DATABASE_URL` is set before deploying.

**Tables don't exist error** — You need to run the SQL schema in Supabase (Step 2a) before the backend can start.

---

## Local Development

After cloning the repo:

```bash
# Install dependencies
npm install

# Copy env file and fill in your Supabase DATABASE_URL
cp .env.example .env
# Edit .env — set DATABASE_URL to your Supabase connection string

# Run dev server
npm run dev
```

The app runs at `http://localhost:5000`.

### Useful database commands

```bash
# Push schema changes to Supabase (alternative to running SQL manually)
npm run db:push

# Open Drizzle Studio (visual DB browser)
npm run db:studio

# Generate migration files
npm run db:generate
```
