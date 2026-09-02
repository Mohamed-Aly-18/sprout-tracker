# Sprout — Nutrition & Water Tracker

A standalone, installable web app (PWA). Log meals in plain English, track water,
macros, and get daily/weekly suggestions — all stored privately in your phone's browser.

This is a normal Vite + React project, plus one small serverless function
(`api/claude.js`) that talks to the Anthropic API on your behalf so your API key
never sits in the browser.

## 1. What you need

- [Node.js](https://nodejs.org) 18 or newer, installed on your computer.
- A free [GitHub](https://github.com) account.
- A free [Vercel](https://vercel.com) account (sign up with GitHub — it's the easiest host for this).
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys).
  This is a *separate* thing from your claude.ai login — it's a developer key you create
  and that gets billed by usage. Set a spend limit in the console if you'd like a safety net;
  personal use of this app costs a small fraction of a cent per meal logged.

## 2. Run it locally first (optional but recommended)

```bash
npm install
npm i -g vercel        # only needed once, lets you run the api/ function locally too
vercel dev
```

`vercel dev` will ask a couple of setup questions the first time — accept the defaults.
Create a `.env.local` file (copy `.env.example`) with your real key before running it, so
the meal-logging and coach-tip features work locally.

If you just want to look at the UI without wiring up a key yet, `npm run dev` works too —
the meal/tip features will show a friendly error until the API route has a key.

## 3. Deploy it so your phone can reach it

1. Create a new GitHub repository and push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Sprout tracker"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/sprout-tracker.git
   git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new), import that GitHub repo.
   Vercel auto-detects Vite — leave the build settings as-is.
3. Before the first deploy (or right after, then redeploy), go to
   **Project → Settings → Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key from step 1
4. Deploy. You'll get a URL like `https://sprout-tracker-yourname.vercel.app`.

## 4. Install it on your phone

**iPhone (Safari):**
Open your Vercel URL → tap the Share icon → **Add to Home Screen** → Add.

**Android (Chrome):**
Open your Vercel URL → tap the ⋮ menu → **Install app** (or "Add to Home screen") → Install.

You'll get a real app icon (the leaf logo) that opens full-screen, no browser
address bar, works like any other app on your phone.

## How your data works

- All logs, goals, and water entries are stored in your phone's **browser storage**
  (`localStorage`), on that device only. There's no account system and nothing is
  synced across devices — that's a deliberate simplicity trade-off, not a bug.
- Clearing your browser's site data, or installing on a second phone, starts fresh there.
  If you'd like real cross-device sync later, that's a good next step (e.g. swapping
  `src/storage.js` for a small database-backed API), just say the word.
- Your Anthropic API key lives only in Vercel's environment variables and inside
  `api/claude.js` on the server. It is never sent to the browser.

## Project structure

```
sprout-tracker/
  src/
    App.jsx          the whole app (UI, logic, styling)
    storage.js        localStorage wrapper
    main.jsx          React entry point
  api/
    claude.js          serverless function that proxies Anthropic API calls
  public/
    icons/, favicon.svg
  vite.config.js       build + PWA (installability) config
```

## Costs

- Vercel free tier: plenty for personal use.
- Anthropic API: pay-as-you-go, billed to the key you created. A single meal
  estimate or coach tip uses well under a cent's worth of tokens.
