# Deploying to Vercel

This guide puts GitHubOps AI online at a public `https://….vercel.app` address that anyone can open. It takes about 15 minutes, and the free plans of Vercel, Supabase and NVIDIA are enough.

## What you need first

| Thing | Where to get it | You'll need |
|---|---|---|
| The code on GitHub | Push this project to a GitHub repository | The repository |
| A database | [supabase.com](https://supabase.com) | The **Session pooler** connection string |
| A GitHub OAuth App | [github.com/settings/developers](https://github.com/settings/developers) | Client ID and Client secret |
| An AI key | [build.nvidia.com](https://build.nvidia.com) | The key that starts with `nvapi-` |

If you already ran the app on your computer (README → *Set up your own copy*), you already have all of these in your `.env.local` file.

## Step 1: Put the code on GitHub

Create an **empty** repository on GitHub (no README, no .gitignore). Then, inside the project folder, run:

```bash
git init
git add .
git commit -m "GitHubOps AI"
git branch -M main
git remote add origin https://github.com/<your-username>/githubops-ai.git
git push -u origin main
```

`.gitignore` keeps your `.env.local` (your keys) out of GitHub automatically.

## Step 2: Import it into Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. Click **Add New → Project** and import the `githubops-ai` repository.
3. Keep the detected settings (Framework: **Next.js**). **Don't click Deploy yet.**

## Step 3: Add the settings

Open **Environment Variables** on the same screen and add these 8 values. Copy them from your `.env.local`:

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase **Session pooler** link, with your password |
| `AUTH_SECRET` | from `.env.local` |
| `TOKEN_ENCRYPTION_KEY` | from `.env.local`. **Never change it later** |
| `CRON_SECRET` | from `.env.local` |
| `AUTH_GITHUB_ID` | OAuth App **Client ID** |
| `AUTH_GITHUB_SECRET` | OAuth App **Client secret** |
| `NVIDIA_API_KEY` | your NVIDIA key |
| `LLM_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` |

Optional: `ADMIN_GITHUB_LOGINS` = your GitHub username, so you're always admin.

If you don't have `.env.local` yet, run `npm run setup` on your computer once. It generates `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` for you.

Now click **Deploy**. When it finishes, Vercel shows your address, e.g. `https://githubops-ai-xyz.vercel.app`.

## Step 4: Allow sign-in on the new address

1. Open your OAuth App at [github.com/settings/developers](https://github.com/settings/developers).
2. Click **Add redirect URI** and enter:

   ```text
   https://githubops-ai-xyz.vercel.app/api/auth/callback/github
   ```

   Use your real address and keep `/api/auth/callback/github` at the end exactly. Your localhost address can stay as well.
3. Make sure **Expire user access tokens** is **unchecked**, then click **Update application**.

## Step 5: Check it works

1. Open `https://your-address.vercel.app/api/health`. It should show `{"ok":true,"database":"ok",...}`.
2. Open `https://your-address.vercel.app` and click **Sign in with GitHub**. The first person to sign in becomes admin (or whoever is in `ADMIN_GITHUB_LOGINS`).
3. Type *List all my repositories* in the chat.

Share the address. That's your live demo.

## What Vercel does automatically

- **Every push to `main` redeploys** the site.
- **Every deploy updates the database:** the `vercel-build` script applies `database/setup.sql` first. It's safe to run again and again.
- **Every day at 03:00 UTC,** the cron job in `vercel.json` refreshes everyone's repository list.
- **Pull requests get their own preview address.** To sign in on a preview, add its address as another redirect URI.

## Before you share it publicly

- If your GitHub client secret or NVIDIA key were ever shared (in a chat, a screenshot, an email), make new ones: GitHub → OAuth App → **Generate a new client secret**, and NVIDIA → new key. Update them in Vercel → **Settings → Environment Variables**, then **Redeploy**.
- Keep `TOKEN_ENCRYPTION_KEY` and `AUTH_SECRET` the same forever. Changing them signs everyone out.

## If something goes wrong

| Problem | Fix |
|---|---|
| The site says *Deployment setup required* | A setting is missing. Add it under **Settings → Environment Variables**, then **Deployments → ⋯ → Redeploy** |
| `/api/health` shows `"database":"error"` | `DATABASE_URL` is wrong. Copy it again from Supabase (**Connect → Session pooler**) and keep special characters encoded (`@` → `%40`) |
| GitHub says *redirect_uri is not associated with this application* | Add the exact Vercel address + `/api/auth/callback/github` as a redirect URI (Step 4) |
| *Sign-in didn't complete* | Click **Sign in with GitHub** again and finish in the same tab within 15 minutes |
| AI replies time out | Check `LLM_MODEL` is `nvidia/nemotron-3.5-lightning-30b-a3b` and `NVIDIA_API_KEY` is correct |
| *Too many connections* once many people use it | In `DATABASE_URL`, change the port `5432` to `6543` (Supabase's transaction pooler) |
| Everyone got signed out after a change | `TOKEN_ENCRYPTION_KEY` or `AUTH_SECRET` was changed. Put the old values back |
