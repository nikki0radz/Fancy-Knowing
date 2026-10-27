# Send Fancy Knowing emails from Gmail

This option does not need Resend or a domain purchase. Only the app owner does this setup. App users receive normal welcome and recovery emails; they never visit Google Apps Script or authorise it.

Use a separate Gmail account for Fancy Knowing if you want app mail and replies kept away from your personal mailbox. Emails are sent from the Google account that owns/deploys the script, with the display name **Fancy Knowing**.

## One-time owner setup

1. Sign in to the Gmail account you want to send from. Open https://script.google.com and choose **New project**. Name it **Fancy Knowing Email**.
2. Open [google-email/Code.gs](google-email/Code.gs), copy the entire code, and replace the default code in the new project. Save.
3. Open the project's **Project Settings → Script Properties → Add script property**:
   - Property: `FANCY_KNOWING_SECRET`
   - Value: a new random connection secret at least 32 characters long. Use a password manager to generate it. This is not your Gmail password.
4. In the editor, select **authoriseSending** from the function dropdown and click **Run**. Review and approve Google's sending-email permission for your own script. This helper checks quota and does not send a test email. MailApp cannot read your inbox.
5. Choose **Deploy → New deployment → Web app**:
   - Description: **Fancy Knowing Email**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy.
6. Copy the **Web app URL**, ending in `/exec` (not the editor URL or `/dev` test URL).
7. In Cloudflare → Workers & Pages → **fancy-knowing** → Settings → Variables and Secrets, add both values as **Secret**:

| Name | Value |
| --- | --- |
| `EMAIL_WEBHOOK_URL` | The Google Web app `/exec` URL |
| `EMAIL_WEBHOOK_SECRET` | Exactly the same random connection secret as step 3 |

`APP_URL` already points to the app's Worker URL. `EMAIL_FROM`, `RESEND_API_KEY` and a Resend account are not required for the Gmail route. If both providers are configured, the Gmail bridge takes precedence.

8. Save/deploy the Worker secret changes. `/api/health` should show `email: true` (configuration present). Create a new test account or request a password reset to verify actual delivery. Use only your own or a consenting recipient's address when testing.

Keep the connection secret out of source, browser code and chat. You can send the developer the Web app URL if needed; do not send your Gmail password or the connection secret.

**Why “Anyone”?** Cloudflare calls the script server-to-server. The script checks the strong secret before doing anything, validates a single recipient, and never exposes a sending form in the public app. Visitors cannot send mail just by opening its URL. Never remove the secret check or paste the secret into the app frontend. “Anyone with a Google account” would require the server to log in and is not the correct setting for this bridge.

If your Google Workspace administrator doesn't permit anonymous Web app deployment, use a normal Gmail account you control or the Resend/domain alternative. Recipients do not need Gmail accounts.

## What users see

- New account → one short welcome email with a link back to Fancy Knowing.
- Forgot password → enter their email → receive a reset link → choose a new password → sign in.
- Existing username accounts can attach and confirm an email, keeping their history.

Welcome delivery runs in the background, so an email outage does not block account creation. A D1 outbox records pending welcomes and retries them hourly, up to eight delivery attempts. Provider-less signups stay queued until delivery is configured. Recovery/confirmation mail is sent when the user requests it. Opening a reset link does not change the password; the user must submit a new one.

## Limits and troubleshooting

Google currently lists 100 email recipients per day for consumer Apps Script accounts. Welcome, recovery and email-confirmation messages all use that allowance; quotas can change. This suits a small personal app, not a large public launch. For more volume, use a transactional provider and your own verified domain; users' app experience stays the same.

If mail doesn't arrive:
- Check spam and confirm the app's email address is correct.
- Check that the script executes as **Me**, access is **Anyone**, and the URL ends with `/exec`.
- Confirm both secrets match. No Gmail login or password belongs in Cloudflare.
- Google Apps Script → Executions can reveal authorisation or quota errors. Do not publish request bodies, tokens or email contents in logs.
- After changing script code, edit its deployment and select a **New version**. Merely saving code does not update an existing `/exec` deployment.

Official references:
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/reference/mail/mail-app
- https://developers.google.com/apps-script/guides/services/quotas
