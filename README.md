# Sprout — Nutrition & Water Tracker

A standalone, installable web app (PWA). Search real USDA nutrition data as you log
meals, track water, weight, and workouts, and see daily/weekly/monthly progress —
all stored privately in your phone's browser.

This is a normal Vite + React project, plus two small serverless functions that
keep your API keys off the device and out of the browser:

- `api/food-search.js` — proxies USDA FoodData Central for the food search.
- `api/claude.js` — proxies Anthropic, used only when you type a free-text meal
  description (like "chicken shawarma plate") instead of picking a search result.

## 1. What you need

- [Node.js](https://nodejs.org) 18 or newer, installed on your computer.
- A free [GitHub](https://github.com) account.
- A free [Vercel](https://vercel.com) account (sign up with GitHub — it's the easiest host for this).
- A free USDA FoodData Central API key from
  [fdc.nal.usda.gov/api-key-signup.html](https://fdc.nal.usda.gov/api-key-signup.html) —
  instant signup, genuinely free, no billing ever. This powers the food search.
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys).
  This is a *separate* thing from your claude.ai login — it's a developer key you create
  and that gets billed by usage. Set a spend limit in the console if you'd like a safety net;
  it's only used for vague/composite meals you type out, so usage is light.

## 2. Run it locally first (optional but recommended)

```bash
npm install
npm i -g vercel        # only needed once, lets you run the api/ functions locally too
vercel dev
```

`vercel dev` will ask a couple of setup questions the first time — accept the defaults.
Create a `.env.local` file (copy `.env.example`) with both real keys before running it, so
food search and freeform meal logging work locally.

If you just want to look at the UI without wiring up keys yet, `npm run dev` works too —
those two features will show a friendly error until the API routes have keys.

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
   **Project → Settings → Environment Variables** and add both:
   - `USDA_API_KEY` = your key from step 1
   - `ANTHROPIC_API_KEY` = your key from step 1
4. Deploy. You'll get a URL like `https://sprout-tracker-yourname.vercel.app`.

## 4. Install it on your phone

**iPhone (Safari):**
Open your Vercel URL → tap the Share icon → **Add to Home Screen** → Add.

**Android (Chrome):**
Open your Vercel URL → tap the ⋮ menu → **Install app** (or "Add to Home screen") → Install.

You'll get a real app icon (the dumbbell mark) that opens full-screen, no browser
address bar, works like any other app on your phone.

## How logging works

- **Search a food** (e.g. "chicken breast") — as you type, matching results appear from
  USDA FoodData Central (Foundation + SR Legacy datasets — analyzed generic foods, not
  packaged products). Tap one, adjust the portion in grams, and add it. Numbers come
  straight from USDA data; nothing is estimated or guessed.
- **Describe a whole meal** instead (e.g. "chicken shawarma plate", "a bowl of pho") and
  just tap **Log it** without picking a search result — that's the one case that goes to
  Claude (Haiku 4.5) to break down and estimate, since there's no single database entry
  for a composite dish. No separate "AI estimate" button — it's automatic based on
  whether you picked a result or not.

## How your data works

- All logs, goals, water, weight, and workout entries are stored in your phone's
  **browser storage** (`localStorage`), on that device only. There's no account system
  and nothing is synced across devices — that's a deliberate simplicity trade-off, not a bug.
- Clearing your browser's site data, or installing on a second phone, starts fresh there.
  Use **Customize → Backup & restore** to export a JSON backup any time, and import it
  back on the same or a different device.
- Your API keys live only in Vercel's environment variables and inside the two
  `api/*.js` files on the server. They are never sent to the browser.

## Project structure

```
sprout-tracker/
  src/
    App.jsx           the whole app (UI, logic, styling)
    storage.js         localStorage wrapper
    main.jsx           React entry point, service-worker registration
  api/
    food-search.js      serverless function that proxies USDA FoodData Central
    claude.js            serverless function that proxies Anthropic (freeform meals only)
  public/
    icons/, favicon.svg
  vite.config.js        build + PWA (installability) config
```

## Costs

- Vercel free tier: plenty for personal use.
- USDA FoodData Central: free, public-domain government data, no billing, ever.
- Anthropic API: pay-as-you-go, billed to the key you created, only for freeform
  whole-meal descriptions. Typical personal use costs a small fraction of a cent per use.
