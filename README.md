# Fancy Knowing

Repository: https://github.com/nikki0radz/Fancy-Knowing

First interactive draft for Nicole's Android daily-learning app. Reference palette: Choose a Loser Question Review (navy #101426, card #1d2540, pink #ed96bc, teal and lavender). Buildless preview in dist/index.html.

## Working in this draft
- Four sample questions, one at a time, multiple choice or exact typed guess.
- Correct-answer feedback, concise explanation and source link.
- Three curated follow-up questions and a chat-style sample conversation per question.
- Saved bank, manual blind review, first due date after 7 days and next after 14 days.
- Device-local answer history, hearts, chat history, theme and reminder time.
- Light/dark modes and an explicitly simulated notification.

## Not implemented yet
No Android APK, real account, server sync, automatic daily generation, live OpenAI chat or actual scheduled phone notifications. The hosted preview is owner-private and is not a shared multi-user account system. Typed answers in this prototype use exact case-insensitive matching; production needs aliases and validated grading. These limitations are deliberate and shown in the UI.

## Android implementation to follow in the user's new GitHub repository
- Capacitor Android shell with stable application ID and signing key; GitHub Actions APK build. Keep the same signing key for updates.
- Cloudflare Worker API and D1 database. OpenAI key stays server-side, never in APK, source or browser storage. Use a vetted account/auth service with persistent revocable sessions. All data access scopes to the authenticated user ID.
- Account records; validated questions and source URLs; per-user answer attempts; saved questions with review due dates; per-question chat turns; settings; device notification registrations.
- Pre-generate a vetted question queue on the server so notifications contain real question text even before the app opens. Validate answer uniqueness and source grounding; reject ambiguous questions. Use a broad topic rotation and semantic duplicate checks against accepted, answered and rejected topics.
- Android notifications: daily configurable schedule, permission onboarding when the user enables it, high-importance notification channel, expanded question body and deep link to the exact question ID. Schedule from cached future questions, replenish on app use; investigate push delivery for long gaps without opening. Handle time-zone changes, reboot, denied permissions and delayed delivery honestly.
- Due saved questions resurface after 7–14 days without showing the old answer first. Record each attempt rather than overwriting history. Let the user pause reviews and reminders.
- Minimal onboarding: sign in/create account and choose reminder time; no interests questionnaire required. Two separate user accounts for Nicole and her mum.

## AI answer contract
Answer the specific question directly in plain, friendly English. Default to 1–3 short sentences. No unrelated facts, harvesting, uses, history, recaps, follow-up questions or lists unless requested. If the premise is false, correct it briefly. Say when unsure; do not invent facts or citations. Provide exactly three distinct short follow-up suggestions with each initial explanation. Retrieve/verify sources before adding a new factual quiz; never treat model confidence as validation.

## Review checks
JavaScript parses successfully. Browser check covers correct-answer feedback, heart save, bank, sample chat and theme/settings. Native/background behavior remains untested because there is no native build yet.
