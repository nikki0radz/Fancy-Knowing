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
- Daily questions begin with online trivia/quiz collections, use fresh wording, and require a cited factual verification source as well as a cited quiz page. A separate editor check rejects ambiguous options, trick wording and near repeats.
- One different question per daily notification slot (1–10), stable per account/day/slot. Today shows a numbered question picker, and notification links identify both day and slot. Existing assignments survive the migration.
- Persistent per-account memory covers assigned, attempted and saved questions without a 120-question cutoff. Exact facts are rejected, stored 256-dimensional `text-embedding-3-small` vectors retrieve related lifetime questions, and the editor compares those alongside recent subtopics. Older question vectors are backfilled when needed. The existing OpenAI key is used; no new service or secret is required.
- Subjects are chosen from the least-served interests, with oldest-served subjects breaking ties. Mixed interests retain two focused questions per exploration question. The same broad chosen category can recur while narrow facts and subjects are screened for repetition.
- Validated multiple-choice answers, short explanations and three follow-up prompts.
- Multiple choice and typed answers with answer aliases, marked on the server.
- Concise live follow-up chat, saved per account and question.
- Persistent answer attempts, saved discoveries, history, blind review and review due dates.
- Two-step name and interest setup, pill-grid subjects and AI-validated custom topics. “Tell me a bit about everything” can stand alone or mix with selected interests (two focused questions for each exploration question).
- Automatic welcome emails, email reset links and confirmed email migration for existing username accounts.
- Separate Design, Notifications, Question preferences and My account settings.
- Solid mustard accent, light/dark slider, hue-wheel palettes, six bundled font previews and text-size controls.
- Header profile shortcut beside the theme switch, custom accent-coloured hour/minute picker, direct topic editor, and an explicit Save settings action alongside autosave.
- Account profile pictures and persistent notification time/frequency preferences, including stable daily random times within a chosen daytime window.
- Saved discoveries reopen their answer and private follow-up conversation; “Try remembering” remains a separate blind refresher.
- Share an answered question using a guest link. Guests need no account, see the answer only after a guess, and have no access to chats or other account features.
- Slim text focus rings, red emoji hearts, and plus signs for follow-up prompts.
- New questions support 2–10 choices (default 4); existing questions retain their original options.
- Per-user API budgets, signup/login limits, origin checks and server-side data ownership.

## Still to do

The connected app runs at https://fancy-knowing.nikki0radz.workers.dev. The older ChatGPT-hosted URL remains the static prototype. Email delivery can use your Gmail via Google Apps Script ([GMAIL-SETUP.md](GMAIL-SETUP.md)) or Resend; see [EMAIL-SETUP.md](EMAIL-SETUP.md).

Android APK and notification delivery are not implemented in this commit. The app stores timing preferences and exposes a per-account local-time schedule at `/api/notification-schedule`, including unique per-slot question links; it does not deliver notifications yet. The hourly worker prepares up to five pending slots per run across the first 20 accounts; a slot not yet prepared is generated on demand. Question count is independent of whether notifications are enabled. Reducing the daily count hides extra slots but keeps their history; already assigned questions retain their original options. Legacy fixed mode spaces additional reminders through the remaining day; individual reminder rows use their explicit chosen times. Random mode spreads the chosen amount through the selected window, changes each day, and stays stable when fetched again on the same day. Welcome emails, recovery and email changes need a configured sender; see EMAIL-SETUP.md. AI citations and checks reduce factual errors but do not make the content infallible.

## Development

Node 22+. `npm install`, `npm run build`, `npm test`. See setup instructions for local secrets, D1 migrations and deployment.

`index.html` and `app.js` are the source; `scripts/build.mjs` copies them into ignored `public/`. Backend modules live in `worker/`. Database changes live in versioned `migrations/`. Guest sharing needs migration `0005_shared_questions.sql`; per-day question slots and semantic memory need `0006_question_slots_memory.sql`. Both are applied automatically by `npm run deploy`. Shared links contain only a random token pointing to a question; personal messages and attempts are never included.

Quality controls reduce ambiguity and repetition but cannot guarantee that an AI-generated fact or similarity decision is perfect. Rejected candidates are retried up to three times; if all fail, no unchecked question is served. New questions may take longer because research, memory comparison and editor review happen before assignment. Existing saved questions are kept intact, and explicitly choosing “Try remembering” revisits a question.

Saved discovery cards open directly; the separate “Try remembering” action stays available. Unsaved hearts use a white outline in dark mode (dark outline in light mode for visibility), while saved hearts remain the red emoji. Notification checkbox colour follows the selected accent.

“Remind me at” uses one styled reminder-type dropdown, with conditional controls for a random window, an exact clock time or a day period. Periods use random, spaced times within Morning 06:00–12:00, Midday 12:00–14:00, Afternoon 14:00–18:00, Evening 18:00–22:00, or Night 22:00–24:00 in the account’s local timezone. This is scheduling configuration; Android delivery is still pending.

Signed-in navigation uses browser history for screens, saved questions, onboarding edits, pop-ups and reminder menus. Back closes the current pop-up or returns to the previous app screen; at the root it stays inside the app. Guest shared-question links retain normal browser navigation. Navigation entries store route identifiers, never form credentials or chat content.

Each question can now have an individual reminder stored in `settings.reminders` (up to the chosen daily question count). Rows independently choose a fixed clock time, random window or day period. Increasing the question count keeps existing rows and asks the user to add the remaining notifications; unconfigured questions have no automatic extra reminders. Reducing the count trims surplus rows through the Settings UI. Existing legacy schedules remain readable; the UI retains their configured times when first opened. The schedule endpoint returns configured and daily question counts, with each notification bound to its question slot. Turning notifications off keeps the configured rows.

Reminder settings use a single type dropdown, conditional inline controls, a curved accent-coloured check mark and a saved-schedule summary. Fixed times show centred hour/minute wheels directly below the type dropdown. Random windows show compact From/Until wheel pairs side by side. Time-of-day selection keeps its dropdown. Scrolling selects the nearest centred value automatically, with keyboard support.

Notification edits are drafts until the local **Save notification** action succeeds. **Cancel** restores the saved row; other Settings actions do not silently save the draft. Saved notifications use compact cards with a Saved label and explicit Edit/Delete actions. All reminders may be deleted, leaving an Add notification option. Each row stores a stable question `slot`, so deleting a notification does not shift remaining reminders to different questions. Legacy rows without a slot retain their original index when read. The daily-question slider is disabled while a notification is being edited; save or cancel the edit before changing the count.
