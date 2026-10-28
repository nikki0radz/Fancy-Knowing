# Fancy Knowing · Cloudflare setup

Use these exact names (including capitalisation):

| Item | Name / value |
| --- | --- |
| GitHub repository | `nikki0radz/Fancy-Knowing` |
| Worker / project | `fancy-knowing` |
| D1 database | `fancy-knowing-db` |
| D1 variable binding | `DB` |
| Static assets binding | `ASSETS` (already in the config) |
| OpenAI secret | `OPENAI_API_KEY` |
| Account invitation secret | `SIGNUP_CODE` |
| Model variable | `OPENAI_MODEL` = `gpt-4.1-mini` (already in the config) |
| Branch | `main` |
| Root directory | repository root; leave blank or `/` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |

## 1. Create the database first

Cloudflare dashboard → Storage & databases → D1 → Create database.

Name it **fancy-knowing-db**. Open its Overview and copy the **Database ID**. This ID is not an API key. Send this ID to the app developer so it can be put in `wrangler.jsonc`, or replace `REPLACE_WITH_D1_DATABASE_ID` yourself and commit to `main`. Do this before deploying: the deploy script deliberately stops until a real ID is present.

Do not use a database belonging to another app.

## 2. Connect the repository as a Worker

Cloudflare → Workers & Pages → Create application → import/connect a Git repository → GitHub → **Fancy-Knowing**. Use a **Worker**, not a Pages-only static site.

Set project name **fancy-knowing**, branch **main**, root directory repository root, build command **npm run build**, deploy command **npm run deploy**.

The deploy command also applies the versioned D1 migration before publishing. It creates the tables, without deleting existing accounts or data. There is no separate public setup endpoint and no SQL to paste manually. The `DB` binding comes from `wrangler.jsonc`; do not create a differently named binding in the dashboard.

If the automatic build token cannot apply the D1 migration, use a Cloudflare build token with D1 Edit and Workers Scripts Edit for this account, or run `npm run db:remote` once using Wrangler signed in to the same account. Do not send API tokens in chat.

## 3. Add the runtime secrets

Open Worker **fancy-knowing** → Settings → Variables and Secrets → Add.

Both of the following must have type **Secret**, not a plain text variable:

- `OPENAI_API_KEY`: your OpenAI API key. Add it directly to Cloudflare. API usage has its own billing; a ChatGPT subscription does not supply API credit.
- `SIGNUP_CODE`: a private invitation code you choose. You and your mum enter this code only when creating your separate accounts. Do not use your account password as this code. Keep it private; anyone who has it can create an account.

Save/deploy the changes. Do not paste either secret into GitHub, the app, or chat. Do not put these secrets in Workers Builds environment variables instead of Worker runtime secrets.

`OPENAI_MODEL` is already set to `gpt-4.1-mini`; it is not secret. You can change the model later by editing the config after checking that the chosen model supports Responses, web search and structured outputs.

## 4. Confirm the connection

Open the exact `workers.dev` address shown by Cloudflare. Use this address for the connected app; the previous ChatGPT-hosted prototype is a separate static demo.

Visit `/api/health` at that address. It should report `app: "fancy-knowing"` and `database`, `ai`, `accounts` all `true`. These flags confirm bindings/secrets exist; successful sign-in and a generated question are the actual end-to-end check.

Create one account for yourself and a different one for your mum. The first question can take a minute to research and prepare. Daily questions follow each account’s chosen interests; your answers, hearts, chats and settings are private to each account. After answering, try a suggested follow-up and a question of your own, save a question, then reload to confirm persistence. Sign in to the other account to confirm its bank starts separately.

Send the Worker URL back so the deployed app can be verified and used in the Android package. Never send the OpenAI key or invitation code.

## Current scope

Implemented: email/password accounts, 90-day sessions, logout, daily sourced AI question, concise live follow-up chat, per-account history, saved questions, blind reviews, due dates, account settings. Server-side passwords are salted PBKDF2 hashes. Session tokens are stored hashed in D1 and sent in secure HttpOnly cookies. API usage is limited per user; account creation needs the invitation code.

The question generator uses web search, requires a returned citation, then requests a validated JSON quiz based on the evidence. Structural checks and duplicate rejection reduce errors; they do not guarantee every factual claim. Follow-up chats do not browse by default and should admit uncertainty. Source links are visible after answering.

The nightly cron prepares interest-based questions for today/tomorrow and clears expired sessions/budgets. It does **not** send phone notifications. Notification delivery and the APK are the next stage. Reminder times are saved, but not active phone alarms yet. Initial accounts use Europe/London dates.

Password recovery and confirmed email changes are implemented. Configure the email sender using EMAIL-SETUP.md before trying them. Existing username accounts can sign in once using the legacy option and attach an email without losing their history. Accounts remain invitation-only.

## Local development (optional)

Node.js 22 or newer. Run `npm install`, copy `.dev.vars.example` to ignored `.dev.vars`, fill the two secrets privately, run `npm run build`, `npm run db:local`, then `npm run dev`. For local-only D1 testing, use any valid UUID as the local database ID and keep that change uncommitted. Live deployment must use the real ID.

Run `npm test`. The integration suite uses an isolated local D1 database and mocked OpenAI responses; it does not use the live API or spend API credit.

## Administrator and extra quiz requests

The normal AI quiz generation limit is enabled at **5 per UK calendar day**. Opening or playing an existing quiz, joining a friend's challenge and writing a handmade quiz do not consume this generation allowance. Daily discoveries, prepared questions, topic approval, score comments and Dive deeper use separate AI calls; the quiz allowance is not a total API spending cap.

To activate your own administrator account:

1. Sign into Fancy Knowing with your own account.
2. Open **Settings → My account → Account reference**, then **Copy account ID**.
3. In the `fancy-knowing` Cloudflare Worker, add `ADMIN_USER_ID` as a **Secret**, with exactly that account ID. Using a Secret keeps this binding through later code deployments. Save/deploy, then refresh the app.
4. **Settings → Admin & usage** now appears only for that account. Never use an email address, display name or permanent friend username for this variable.

There is no browser-side way to promote an account. The server checks the configured immutable ID for every admin request. Leave this variable unset to keep admin access disabled.

At zero allowance, a person can request five extra generations. The administrator approves or declines in Admin & usage, or grants 1–20 extra generations directly to an account. Approvals are replay-safe, per account and valid only until midnight Europe/London. No reusable unlock code or payment is required.

Admin & usage includes historical successful AI/handmade quiz counts, today's successful AI quiz count, and 30 days of future API usage metadata grouped by feature and model. Token telemetry begins with this release; it cannot reconstruct previous token spend or failed generation costs. It stores token counts, request status, search counts and operation IDs, not prompts, replies, passwords or API keys. Search counts are marked inferred when the provider does not report exact billable tool usage. Use OpenAI's usage dashboard for final charges, discounts, search-content charges and any usage whose token data is missing.
