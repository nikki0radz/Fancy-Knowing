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

### Combined home and asynchronous challenges

Home combines a compact, revisitable Today’s questions list with a featured Challenge a friend panel and smaller Ask me another question / A quick quiz actions. Solo and friend quizzes support easy, medium and hard difficulty, custom validated topics, and researched, citation-checked questions. Quizzes have 5 or 10 questions; an extra discovery has one. Generation checks the creator’s lifetime question memory and uses the account’s multiple-choice count.

A challenge invitation admits one opponent, who may play in a browser without an account. A secure guest cookie restores their progress in that browser. Both players answer the same questions in the same order; saved choices are immutable. Scores, explanations and the winner appear after both finish. Equal scores produce a draw. Registered participants can then save a question or continue its AI conversation. Invitations are shared manually by the creator.

Completed challenges create persistent per-account notifications and a bell badge, cleared when the result is opened. The signed-in page checks for updates every 30 seconds and on return to the tab. Optional browser notification permission enables OS alerts while the page is running. This is **not background push**: delivery with the app/browser fully closed still requires Android or Web Push infrastructure. No new automatic email is sent for challenges. Deploy migration `0007_trivia_challenges.sql` before the updated Worker (`npm run deploy` includes it).

### Reminder, account and friends refinements

- Reminder cards keep Saved beside the question label, with accessible pencil/delete buttons at the top right. Day-part names and ranges share one row; random windows have separated From/Until wheels. Turning question notifications off hides their timing controls and keeps saved schedules. The question-count slider lives in Question preferences.
- Morning now defaults to 08:00–12:00. A reminder editor can change the selected day-part window; saving persists `settings.periodWindows` and applies it to every reminder using that day part. Windows must last at least ten minutes and may end at midnight. Cancel leaves saved windows unchanged.
- Light mode uses cream, warm sand cards and paler inputs for stronger surface separation; custom background/accent choices remain supported.
- Account settings provide pencil controls for the avatar and display name, plus a permanent, copyable friend username. Migration 0008 assigns usernames to existing accounts; new accounts receive random word-based usernames. Display-name and email changes do not change this identifier.
- Friends & challenges is a fourth navigation tab: add exact usernames, accept/decline/cancel requests, remove friends, start a quiz for an accepted friend, and revisit past challenges. Friend-only invitations require that account to join; manually shared open invitations still support guests. The bell opens a notifications-only inbox for challenge invitations and results. A completed invitation becomes a new unread result exactly once.
- New AI output includes an exact `correctAnswer` string matched against the marked option, and an independent editor must return the same answer text before a question is stored. Both daily and session quizzes use these checks. Migration 0009 corrects the reported Tungsten/Gold item, removes its disputed temperature and universal-record claim, regrades its saved attempts, and retains the original data in `corrected_question_keys`. Checks reduce errors; a curated question bank remains future work.

### Varied quiz sessions and clearer results

- Daily discoveries and sessions mix multiple choice, true/false and two-category classification. Multiple-choice preferences affect only multiple-choice items; binary formats always have two options. Options are shuffled on the server before persistence, so the correct index, typed answer and both challenge participants remain consistent.
- Session length is any integer from 2 to 20. The extra-discovery action still asks one question. Difficulty uses a three-position slider. Topic lookup actually validates through `/api/topics`; Start is enabled only after approval. Personal topic usage controls the short list, with a More topics expansion. General knowledge replaces Mixed topics (the legacy alias is accepted).
- Start shows a research card with the selected topic, question count, difficulty and format mix. Answer submission preserves the existing DOM while saving; short scoped view transitions replace repeated pending-state rerenders. Reduced-motion preferences disable animated transitions and score effects.
- The result hero counts up to the score and fetches a short, cached AI reaction per player: playful roast below 40%, neutral between 40% and 79%, congratulations from 80%. If the AI is unavailable, a local reaction appears. Every review card visibly says Got it or Missed it before expansion. Hearts save individual questions; a compact Dive deeper action opens that question’s private chat without leaving the result screen.
- New questions use metric measurements. Question preferences can show imperial equivalents alongside the original values for precision; conversions do not change stored facts or answer indices. Typed answers also accept the displayed imperial equivalent. Challenge participants can use separate display-unit preferences.
- Quiz generation keeps independently checked candidates and retries only missing formats, up to three research rounds. Primary-source web verification is followed by separate factual and plain-language sense checks per candidate. Daily questions also receive independent web verification. Unsafe or unverifiable facts are still rejected; insufficient evidence results in a clearer suggestion to shorten or broaden the quiz. A curated question-bank import is not part of this change.
- Apply migration `0010_quiz_reveal.sql` for cached player verdicts; the deploy script applies it automatically.

### Personal discoveries, profiles and group quizzes

- Ask me another question consumes a prepared discovery from the account’s approved interests, with no setup screen or difficulty choice. The buffer targets eight unused questions; generation starts before it runs low. The first fill needs research once. Browser requests and the five-minute scheduled worker refill it and prepare daily slots for today plus the next three days. Initial filling is gradual; no system can guarantee an instant new question during an AI outage or after a burst that exhausts the reserve. Empty reserves show a preparation message instead of serving an unverified fact.
- Prepared questions and future daily slots are keyed to profile interests and multiple-choice preferences. Changing those preferences makes old queued items ineligible. Queue consumption is atomic, and prepared facts participate in lifetime memory so the reserve does not duplicate itself.
- Custom topic labels retain the user’s exact wording after validation. The known expanded shark-species label is repaired by migration 0012. New friend usernames use CamelCase words plus digits, and migration 0011 restyles existing names while retaining old names as lookup aliases. Email login and friend relationships stay unchanged.
- The header avatar opens My profile with photo, copyable username, interests and private discovery/accuracy/saved/quiz/friend statistics. Saved cards place the category beside Try remembering, and the count subheading contains only the discovery count. Trophy navigation sits immediately before Settings. Light-mode answer feedback uses stronger green/red fills and borders.
- Quiz settings offer an optional 10–120 second timer, off by default. The selected time is copied to a new quiz for all players. Deadlines are server-controlled and survive refresh; late answers are recorded as unanswered. Existing quizzes retain their original timing.
- New friend quizzes are group lobbies, with up to 100 participants. The host can select several accepted friends or copy a guest link; guests enter a name and play without accounts. A solo quiz can be promoted to a shared lobby without losing answers or scores. Participants see their result after finishing, and the host sees completed scores as they arrive. Guests cannot use account saving or AI chat, and their result reaction is local. Older two-player challenges retain their original reveal rules.
- The host can close or reopen entries. Closing prevents new joins while allowing existing players to finish; final standings appear when entries are closed and all joined players have finished. Profile and invitation APIs remain account-scoped. Guest cookies reconnect only their own browser to its participation.
- Deploy migrations 0011 and 0012 before publishing the Worker; `npm run deploy` applies them automatically. The cron now runs every five minutes and rotates preparation across accounts.


### Challenge rankings and phone alerts

Shared quizzes rank completed entries by score, then the sum of server-recorded answer times. Older entries without recorded timing stay tied on score. A crown is provisional while a quiz is open; a trophy is awarded after the host closes it. Closing stops joins and answers; reopening preserves saved answers and excludes the closed interval from the active question clock.

Settings → Notifications connects a browser to encrypted Web Push and lets each account switch friend requests, accepted requests, challenge invitations and quiz results on or off. In-app notifications remain available regardless of phone preferences. Use “Send a test notification” on the phone to verify browser/OS delivery. VAPID keys are generated once into server-only D1 storage; only the public key is returned to authenticated browsers. No sender key setup is required. Explicit sign-out disconnects the current device.

`QUIZ_LIMITS_ENABLED` remains `false` during testing. `QUIZ_DAILY_LIMIT` is set to `5`, ready for re-enabling the cap later. The results page does not offer automatic quiz regeneration.

Web Push uses the pinned, vendored `@block65/webcrypto-web-push` 2.0.0 and `uint8array-extras` 1.6.0. Both MIT licences are retained in `licenses/`.

Recent interaction updates: quizzes start on General knowledge, with topic search behind Change. Guest links have inline copy/share controls. Home activity lists unread updates only and removes an update when opened; the notification inbox retains read history. Saving a question offers an editable 1–365 day refresher or Just save it. Refresher opt-outs persist through later answers. Quiz generation now compares semantic similarity across candidates within the same batch as well as prior account history, and independently reviews batch duplicates.

Friends & challenges now combines a per-quiz podium, unread Fresh drama activity, separate Friends tab, and a trophy cabinet below the challenge lists. Trophies represent final wins from the recent challenge history; open quizzes show provisional crowns. Quiz creator names are visible in challenge cards, leaderboards and the quiz itself, including guest views. Candy Cloud replaces the old mustard defaults in light/dark mode; custom colour choices are preserved.

Quiz setup now uses one modal step at a time: topic, difficulty, length, per-question timer (unlimited by default), friend selection for challenges, and review. Generated quizzes enter an explicit ready lobby; opening a lobby or sending invitations does not start its clock. Start is per player and idempotent. Challenges remain asynchronous; this is not a live multiplayer release. Quizzes hide invitations and the leaderboard during questions, then show a deliberate score reveal (dramatic for challenges, quieter for solo).

Build your own quiz appears below Home activity. Handmade challenges support 1–20 questions, 2–10 choices, true/false, explicit answer keys and optional explanations. The title, saved questions and current editor draft persist locally per account until successful creation. Handmade creation bypasses AI-generation quotas, never uses AI for content or verdicts, and is excluded from AI memory/research. Existing quizzes retain their previous start behaviour. Migration 0017 adds lobby/manual flags and per-player start times.

## Question-bank updates and requests

Sign into the designated administrator account, then open **Settings → Admin & usage → Manage the question bank**. If Admin & usage is absent, copy the account ID from **My account → Account reference**, set the Worker secret `ADMIN_USER_ID` to that exact ID, and save/deploy. Do not use an email or friend username for this secret. Recreating an account gives it a new ID.

Keep the Excel workbook as your editable master. Export only its **Question bank** sheet as **CSV UTF-8**, preserving its column headings. Required headings are Question ID, Question, Correct answer, Wrong answer 1–3, Type, Category, Difficulty, Explanation, Reference / source URL, Status and Fact ID. Topic and semicolon-separated Broad tags, Specific tags and Search aliases are supported. Multiple choice has four distinct answers; true/false has two.

The upload previews rows, then imports batches of 50. Only rows marked **Ready** are enabled. Ready rows need a source URL and explanation. Another status disables the matching ID in the selected audience. Removing a row from a file does not delete or disable it. If a batch fails, earlier batches remain imported; correcting and re-uploading the same IDs is safe.

Choose **Everyone** for the main bank. For an account-specific bird collection, export the additional rows separately, choose that account, and optionally label the batch **Bird species**. Keep the same audience and label on subsequent uploads. Stable Question IDs update bank rows; stable Fact IDs prevent the same fact being chosen again under different wording. Already assigned questions and existing quizzes retain their original answer snapshots. Personal collections are available to their owner, who may share quizzes using those questions.

Bank quizzes, daily questions and prepared discoveries use no OpenAI calls for question selection. Covered quiz subjects with insufficient unseen questions return an explanation; they do not silently fall back to AI. Uncovered quiz subjects still use the existing AI generation and daily credit limit. With a bank available, daily and extra discoveries prefer the chosen interests when covered and otherwise draw from the available bank. The bank excludes known history for the host and friends selected before creation; later guests can still have seen a question previously.

**Quiz allowance & extra requests** accepts requests before an allowance is empty, with an optional note. The admin can reply, decline, or gift a custom amount. Topic suggestions also have private request conversations. In-app notifications and optional phone alerts point to the conversation. Gifted AI quiz credits last until midnight UK time on the approval/gift day; the archive remains afterwards. Setting the relevant notification switches does not replace device/browser push permission.
