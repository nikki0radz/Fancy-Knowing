# Fancy Knowing

A daily learning app: one trivia question, a short explanation, and an optional AI conversation. Navy/mustard styling with light and dark modes.

## Connect Cloudflare

Follow [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md). Exact resource names:

- Worker: `fancy-knowing`
- D1 database: `fancy-knowing-db`, binding `DB`
- Runtime secrets: `OPENAI_API_KEY` and `SIGNUP_CODE`

First create the D1 database, then insert its Database ID into `wrangler.jsonc`. The deployment script stops until this is done. Connect this repo to Workers Builds with build `npm run build` and deploy `npm run deploy`. The deploy script applies migrations, then deploys both app and API. No keys belong in this repository.

## Implemented

- Separate invitation-only email/password accounts with secure persistent sessions and logout.
- An interest-based daily AI question researched with web search and a cited source, validated choices, short explanation and three follow-up prompts.
- Multiple choice and typed answers with answer aliases, marked on the server.
- Concise live follow-up chat, saved per account and question.
- Persistent answer attempts, saved discoveries, history, blind review and review due dates.
- Two-step name and interest setup, pill-grid subjects and AI-validated custom topics. “Tell me a bit about everything” can stand alone or mix with selected interests (two focused days for each exploration day).
- Automatic welcome emails, email reset links and confirmed email migration for existing username accounts.
- Separate Design, Notifications, Question preferences and My account settings.
- Solid mustard accent, light/dark slider, hue-wheel palettes, six bundled font previews and text-size controls.
- Account profile pictures and persistent notification time/frequency preferences, including stable daily random times within a chosen daytime window.
- Saved discoveries reopen their answer and private follow-up conversation; “Try remembering” remains a separate blind refresher.
- Share an answered question using a guest link. Guests need no account, see the answer only after a guess, and have no access to chats or other account features.
- Slim text focus rings, red emoji hearts, and plus signs for follow-up prompts.
- New questions support 2–10 choices (default 4); existing questions retain their original options.
- Per-user API budgets, signup/login limits, origin checks and server-side data ownership.

## Still to do

The connected app runs at https://fancy-knowing.nikki0radz.workers.dev. The older ChatGPT-hosted URL remains the static prototype. Email delivery can use your Gmail via Google Apps Script ([GMAIL-SETUP.md](GMAIL-SETUP.md)) or Resend; see [EMAIL-SETUP.md](EMAIL-SETUP.md).

Android APK and notification delivery are not implemented in this commit. The app stores timing preferences and exposes a per-account local-time schedule at `/api/notification-schedule`; it does not deliver notifications yet. Fixed mode spaces additional reminders through the remaining day. Random mode spreads the chosen amount through the selected window, changes each day, and stays stable when fetched again on the same day. Welcome emails, recovery and email changes need a configured sender; see EMAIL-SETUP.md. AI citations and checks reduce factual errors but do not make the content infallible.

## Development

Node 22+. `npm install`, `npm run build`, `npm test`. See setup instructions for local secrets, D1 migrations and deployment.

`index.html` and `app.js` are the source; `scripts/build.mjs` copies them into ignored `public/`. Backend modules live in `worker/`. Database changes live in versioned `migrations/`. Guest sharing needs migration `0005_shared_questions.sql`, applied automatically by `npm run deploy`. Shared links contain only a random token pointing to a question; personal messages and attempts are never included.
