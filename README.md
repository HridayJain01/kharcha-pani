# Kharcha Pani 💸

A tiny, offline-first spending tracker for your phone. Type (or say) what you spent the lazy way:

> chai 15, 2 autos 40 each, zomato 250 yesterday, movie 300

Gemini turns it into tidy entries in fun categories. You check them and hit **SAVE IT**.
There's no login, no backend and no cost: your data lives only on your device.

- **Add**: today's total, a quick-add box with a mic, and a preview you can edit before anything is saved
- **Ledger**: every entry grouped by day, with search, category filters, and edit or delete
- **Overview**: day, week or month totals, change vs the previous period, a donut and daily bars, top categories, fun stats, a budget meter, and **ROAST ME 🔥**
- **Settings**: Gemini key and model, currency, categories (add, rename, recolour), budget, CSV export, zip backup and restore

With no key, no internet, or a Gemini error, a built-in offline parser takes over. It splits on commas, "and" and new lines, reads the amounts, and guesses the category from keywords.

## 1. Get a free Gemini API key

1. Go to **https://aistudio.google.com/apikey** and sign in with a Google account.
2. Click **Create API key** and copy it (it starts with `AIza`).
3. Open the app and paste it on the first screen. You can change it later in **Settings**, where **Test key** checks it.

The key is stored only in your browser's IndexedDB on that device. It never goes into the code, a `.env` file, or backups.
The default model is `gemini-2.5-flash-lite` (fast and free-tier friendly). You can change the model in Settings.

What gets sent to Google: the text you type to log spends, and, when you tap ROAST ME, a summary of totals, counts and item names. Photos never leave the device.
Note that on the free tier Google may use prompts to improve its products, so don't type anything you'd mind them seeing.

## 2. Run it locally

You need Node.js 22.18 or newer (`npm test` runs TypeScript directly in Node).

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (for example http://localhost:5173). To try it on your phone on the same Wi-Fi, run `npm run dev -- --host` and open the network URL.
Note that the mic and installing need HTTPS, which the deployed version has.

Other scripts:

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build (with the service worker)
npm test          # quick self-check of the offline parser, dates and stats
```

## 3. Deploy to Vercel (free)

**From GitHub (easiest):**

1. Push this folder to a GitHub repo.
2. Go to **https://vercel.com/new**, sign in with GitHub and import the repo.
3. Vercel detects Vite by itself (build command `npm run build`, output folder `dist`). Click **Deploy**.
4. You get a URL like `https://kharcha-pani-you.vercel.app`. Every push to `main` redeploys.

**Or from the terminal:**

```bash
npx vercel --prod
```

Nothing needs configuring: there are no environment variables and no server.

## 4. Install it on your phone

**Android (Chrome):** open your Vercel URL, tap the **⋮** menu, then **Install app** (on some phones it's **Add to Home screen**), and confirm.

**iPhone (Safari):** open your Vercel URL in Safari, tap the **Share** button (the square with an arrow), scroll down to **Add to Home Screen**, then tap **Add**.

It opens full-screen in portrait like a normal app and works offline after the first visit.
When you deploy a new version, the app updates itself the next time you open it.

**Voice:** the 🎤 button shows up where the browser supports speech recognition (for example Chrome on Android). Everywhere else, the dictation mic on your keyboard works in the same box.

## Your data

- Everything (entries, categories, photos) is stored in IndexedDB on that one device and browser. Clearing site data or uninstalling deletes it.
- **Settings → Backup** makes a zip of all entries, categories and photos. **Restore** replaces everything on the device with a backup. Do a backup now and then, and before switching phones.
- **Settings → Ask for persistent storage** asks the browser not to auto-clear your data when space runs low. Installed apps usually get this.
- **CSV** export opens straight in Excel or Google Sheets.

## Tech

React, Vite, TypeScript, Tailwind CSS 4, vite-plugin-pwa (Workbox), Dexie (IndexedDB), Recharts, JSZip, and the Gemini REST API called straight from the browser.

```
src/
  lib.ts              types, default categories, dates, offline parser, stats (pure, tested by lib.test.ts)
  db.ts               Dexie schema, settings, live-query hooks, save/update/delete
  ai.ts               Gemini calls: parse, roast, key test
  fx.ts               coin clink, coin burst, confetti, toasts
  components/Entry.tsx  entry card, editable fields and photos, edit sheet
  screens/            Onboarding, Add, Ledger, Overview, Settings
```
