# Fancy Knowing

A daily learning app: one trivia question, a short explanation, and an optional AI conversation. Navy/pink styling with light and dark modes.

## Connect Cloudflare

Follow [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md). Exact resource names:

- Worker: `fancy-knowing`
- D1 database: `fancy-knowing-db`, binding `DB`
- Runtime secrets: `OPENAI_API_KEY` and `SIGNUP_CODE`

First create the D1 database, then insert its Database ID into `wrangler.jsonc`. The deployment script stops until this is done. Connect this repo to Workers Builds with build `npm run build` and deploy `npm run deploy`. The deploy script applies migrations, then deploys both app and API. No keys belong in this repository.

## Implemented

- Separate invitation-only username/password accounts with secure persistent sessions and logout.
- A shared daily AI question researched with web search and a cited source, validated choices, short explanation and three follow-up prompts.
- Multiple choice and typed answers with answer aliases, marked on the server.
- Concise live follow-up chat, saved per account and question.
- Persistent answer attempts, saved bank, history, blind review and review due dates.
- Light/dark mode and saved reminder time.
- Per-user API budgets, signup/login limits, origin checks and server-side data ownership.

## Still to do

Cloudflare deployment and live API verification require the user's database ID and runtime secrets. The older ChatGPT-hosted URL remains the static prototype. The connected version runs at the Cloudflare Worker URL once deployed.

Android APK and notification delivery are not implemented in this commit. Reminder time is stored only. Password recovery/email verification are not implemented. AI citations and checks reduce factual errors but do not make the content infallible.

## Development

Node 22+. `npm install`, `npm run build`, `npm test`. See setup instructions for local secrets, D1 migrations and deployment.

`index.html` and `app.js` are the source; `scripts/build.mjs` copies them into ignored `public/`. Backend modules live in `worker/`. Database changes live in versioned `migrations/`.
