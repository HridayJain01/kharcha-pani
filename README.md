# Kharcha Pani 💸

A tiny, offline-first spending tracker for your phone. Type (or say) what you spent the lazy way:

> chai 15, 2 autos 40 each, zomato 250 yesterday, movie 300

It turns that into tidy entries in fun categories. You check them and hit **SAVE IT**.
There's no login, no backend and no cost: your data lives only on your device.

- **Add**: today's total, a quick-add box with a mic, and a preview you can edit before anything is saved
- **Ledger**: every entry grouped by day, with search, category filters, and edit or delete
- **Overview**: day, week or month totals, change vs the previous period, a donut and daily bars, top categories, fun stats, a budget meter, and **ROAST ME 🔥**
- **Udhaar 🤝**: type `gave rahul 500 for books`, `amit se 200 liye`, `rahul paid back 300` or `dinner 1200 split with rahul, neha` in the same box. The reason is optional. Udhaar never counts as spending, and Overview shows **To take** and **To give** for each person, with their full history
- **Settings**: optional AI key, offline voice model, currency, categories (add, rename, recolour), budget, CSV export, zip backup and restore

## How it understands you

**Works offline, no key needed.** The built-in parser handles the way people actually type and talk:

- no commas needed: `chai 15 two autos 40 each metro 60`
- spoken numbers: `two fifty` = 250, `two hundred and fifty`, `1.5k`, `paanch sau` = 500, `do chai`
- quantities: `2 autos 40 each`, `samosa 2 @ 15`, `chai x3 45`, `2 samosa for 30`, `2 kg atta 110`
- amount first: `500 for electricity bill`, `spent 200 on petrol`
- dates: `yesterday`, `kal`, `day before yesterday`, `last friday`. A date said first (`yesterday: auto 80, lunch 120`) covers everything after it.
- categories: hundreds of built-in Indian keywords (Zomato, Rapido, Blinkit, pani puri…), typo-tolerant (`zomatto`, `swigy`), and it **learns from you**: however you've filed an item before is how it gets filed next time.

**Optional AI key** for messier notes and ROAST ME. All three are free to start:

| Provider | Get a key | Why |
|---|---|---|
| **Groq** (recommended) | https://console.groq.com/keys | Free, extremely fast, and upgrades voice to Whisper large |
| Gemini | https://aistudio.google.com/apikey | Google's free tier |
| Other | your provider | Any OpenAI-compatible API: OpenRouter, Mistral, Cerebras, or Ollama on your own computer. Paste its base URL (e.g. `https://openrouter.ai/api/v1`) and a model that supports JSON schema output. |

Paste the key on the first screen or in **Settings → AI**. **Test key** checks the key, the model name and JSON output in one go.
Keys are stored only in your browser's IndexedDB on that device. They never go into the code, a `.env` file, or backups.
Switching providers clears the key, so one company's key is never sent to another's API.
Even with AI on, your own history wins: an item you've filed the same way twice keeps its category.

## Voice notes 🎤

Tap the mic, talk, tap again. What you said appears in the box and gets parsed straight away.

- **With a Groq key and signal:** Groq's hosted **Whisper large-v3** transcribes it, in English, Hindi or Hinglish. This is the most accurate option (about 1 s; free tier: 2,000 notes a day).
- **Otherwise:** a small speech model runs **on your phone**: [Moonshine base](https://huggingface.co/onnx-community/moonshine-base-ONNX) via Transformers.js, in a background worker. It downloads once (~80 MB, and the app asks first), then works fully offline and privately. Warm transcription takes well under a second on a laptop, a bit longer on phones. You can also download or remove it in **Settings → Voice**.

The keyboard's own dictation mic works in the box too.

**What leaves the device:** with an AI key, the text you log goes to that provider; with a Groq key, voice recordings go to Groq's Whisper; ROAST ME sends a summary (totals, counts, item names). Photos never leave the device, and nothing is sent anywhere without a key.
On free tiers, providers may use prompts to improve their products, so don't type anything you'd mind them seeing.

## Share your key so users set up nothing (optional)

Deploy with your own Groq key on the server, and every user gets Whisper voice and AI parsing with zero setup. The key stays on the server (`api/groq.ts`), so it never reaches anyone's phone.

1. Get a free Groq key at https://console.groq.com/keys.
2. In Vercel, open your project, then **Settings → Environment Variables**, and add:
   - `GROQ_API_KEY` = your `gsk_…` key
   - `VITE_SHARED_AI` = `1` (turns on the shared mode in the app)
   - optional: `DAILY_LIMIT_PER_IP` (default `150` requests per person per day)
3. Redeploy (Deployments → ⋯ → Redeploy).

What changes for users: onboarding no longer asks for a key, and voice and parsing just work. Anyone who adds their own key in Settings uses theirs instead.

Good to know:

- **Limits are shared.** Groq's free tier is roughly 1,000 AI parses and 2,000 voice notes a day across all your users. Past that, add billing on Groq (cheap) or users fall back to the offline parser and the on-device voice model automatically.
- **Protection is basic.** The function only accepts requests from your own site, only the app's fields, always your chosen models, and caps each person per day. The per-day count lives in memory, so it resets when Vercel restarts the function; if someone abuses it, move the counter to Upstash or Vercel KV.
- **Privacy.** Everyone's notes and voice clips pass through your function and your Groq account.
- **Local testing:** `npm run dev` doesn't run `api/`. Use `npx vercel dev` with the same variables in a `.env.local` file.

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
npm test          # self-check of the offline parser (typed and spoken styles), dates and stats
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

**Voice:** the in-app 🎤 works in the installed app on both Android and iPhone (allow the microphone when asked). The first time without a Groq key, it offers to download the offline voice model, so do that on Wi-Fi.

## Your data

- Everything (entries, categories, photos) is stored in IndexedDB on that one device and browser. Clearing site data or uninstalling deletes it.
- **Settings → Backup** makes a zip of all entries, categories and photos. **Restore** replaces everything on the device with a backup. Do a backup now and then, and before switching phones.
- **Settings → Ask for persistent storage** asks the browser not to auto-clear your data when space runs low. Installed apps usually get this.
- **CSV** export opens straight in Excel or Google Sheets.

## Tech

React, Vite, TypeScript, Tailwind CSS 4, vite-plugin-pwa (Workbox), Dexie (IndexedDB), Recharts, JSZip, Transformers.js (on-device Moonshine), and the Groq, Gemini or any OpenAI-compatible REST API called straight from the browser.

```
src/
  lib.ts              types, categories + keywords, dates, offline parser, learning, stats (pure, tested by lib.test.ts)
  db.ts               Dexie schema, settings, live-query hooks, save/update/delete
  ai.ts               AI providers (Groq, Gemini, OpenAI-compatible): parse, roast, key test, Whisper
  voice.ts            mic recording, cloud vs on-device transcription
  asr.worker.ts       on-device speech model (Transformers.js) off the main thread
  fx.ts               coin clink, coin burst, confetti, toasts
  components/Entry.tsx  entry card, editable fields and photos, edit sheet
  screens/            Onboarding, Add, Ledger, Overview, Settings
```
