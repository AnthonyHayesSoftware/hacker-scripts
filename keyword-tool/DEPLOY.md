# Deploy this app to Railway — a no-code, step-by-step checklist

Written for a non-developer. You don't need to touch any code. The whole thing
takes ~15 minutes. ☕

**What you're deploying:** the Keyword Ideas web app. It lives in the
`keyword-tool/` folder inside your `hacker-scripts` repository — that folder
detail matters in Step 3, so don't skip it.

---

## Before you start (1 minute)
You need:
- [ ] A GitHub account (you have this: `AnthonyHayesSoftware`)
- [ ] A Railway account (you set one up last month for the ebook creator)
- [ ] The code on your **main branch** (called `master` in this repo) — see Step 1

---

## Step 1 — Get the code onto your `master` branch
Right now the app is on a working branch called `claude/stoic-bell-YFemf`, not on
`master`. Railway deploys from your main branch, so we move it over once.

**Easiest way (recommended):** Ask me to open a Pull Request. You'll get a green
**“Merge pull request”** button on GitHub — click it, then **“Confirm merge.”**
That copies the app into `master`. Done.

**Or, in GitHub Desktop:**
- [ ] Open GitHub Desktop → top bar, **Current Branch** → pick `master`
- [ ] **Branch** menu → **Merge into current branch…** → choose
      `claude/stoic-bell-YFemf` → **Create a merge commit**
- [ ] Click **Push origin** (top right)

✅ When this is done, your `master` branch contains the `keyword-tool/` folder.

---

## Step 2 — Create the Railway project
- [ ] Go to **https://railway.app** and log in
- [ ] Click **New Project**
- [ ] Choose **Deploy from GitHub repo**
- [ ] If asked, **Configure GitHub App** and give Railway access to the
      `hacker-scripts` repository
- [ ] Pick **`AnthonyHayesSoftware/hacker-scripts`** from the list

Railway will create a service and try a first build. It may fail or look wrong
until Step 3 — that's expected, because it doesn't yet know the app is in a
subfolder.

---

## Step 3 — Tell Railway the app is in the `keyword-tool` folder ⚠️ (the key step)
This is the one thing people miss.
- [ ] Click your service (the box/tile) → **Settings** tab
- [ ] Find **Root Directory** (under “Source” / “Build”)
- [ ] Type: **`keyword-tool`**  ← exactly this, no slashes
- [ ] Save

Railway now builds from the right folder. It auto-detects Node.js and runs
`npm start` for you (no settings needed — it's in the project's config files).

---

## Step 4 — Confirm the branch is `master`
- [ ] Service → **Settings** → **Source** → check the deploy branch is
      **`master`** (change it if it shows something else) → Save

A new deployment will start. Watch the **Deployments** tab — wait for **“Success.”**
(If it's still building, give it a minute.)

---

## Step 5 — Turn on a public web address
By default Railway builds the app but doesn't expose it to the internet yet.
- [ ] Service → **Settings** → **Networking**
- [ ] Click **Generate Domain**
- [ ] Railway gives you a URL like `something.up.railway.app`
- [ ] Open it — you should see the Keyword Ideas app 🎉

> If the page loads but a search returns nothing, that's a network thing, not a
> bug — see Troubleshooting below.

---

## Step 6 (optional) — Use your own subdomain
Want `keywords.yourdomain.com` instead of the railway.app URL?
- [ ] Service → **Settings** → **Networking** → **Custom Domain**
- [ ] Type your subdomain, e.g. `keywords.yourdomain.com`
- [ ] Railway shows a **CNAME** target (a string like `xxx.up.railway.app`)
- [ ] Go to your domain provider (GoDaddy, Namecheap, Cloudflare, etc.) → DNS
- [ ] Add a **CNAME** record:
      **Name/Host:** `keywords` — **Value/Target:** the string Railway showed
- [ ] Save. It can take a few minutes to a couple of hours. Railway adds the
      padlock (HTTPS) automatically.

---

## Making updates later (your GitHub Desktop workflow)
Once it's live, updating is the loop you already know:
1. Edit files in your local `hacker-scripts` folder (the app is under `keyword-tool/`)
2. In **GitHub Desktop**: write a short summary → **Commit to master**
3. Click **Push origin**
4. Railway sees the push and **redeploys automatically** — no extra steps

---

## Troubleshooting
- **Build fails:** 99% of the time it's Step 3. Re-check **Root Directory** is
  exactly `keyword-tool`.
- **Page loads but searches return nothing / spin forever:** the app calls
  Google's free Suggest service. Railway's default network access allows this; if
  your Railway project was created with a restricted network policy, outbound
  calls to Google may be blocked. Create the service with default/standard
  network access, or contact me and I'll help check.
- **404 / “Application not found”:** you probably haven't done Step 5 (Generate
  Domain) yet.
- **Old version showing:** hard-refresh your browser (Ctrl/Cmd + Shift + R).

---

That's everything. If any screen doesn't match these words (Railway tweaks their
UI now and then), tell me what you see and I'll translate.
