# Fancy Knowing · Email sign-in and password recovery

**Want to send from Gmail without Resend or a custom domain? Follow [GMAIL-SETUP.md](GMAIL-SETUP.md) instead. Only the app owner configures the sender. Recipients use the normal welcome/reset-email flow.**

Version 0.3.0 adds email sign-in, name/interests onboarding, custom-topic validation, and password recovery. The existing deployment applies migration `0002_email_profiles.sql` automatically, keeping old accounts, saved questions and chats.

## Set up email delivery for practising

The app sends transactional emails through Resend. You do not need to connect your personal inbox to the app.

1. Create an account at https://resend.com using the same email address you want to practise with in Fancy Knowing.
2. In Resend → API Keys, create a Sending access API key. Copy it privately.
3. In Cloudflare → Workers & Pages → **fancy-knowing** → Settings → Variables and Secrets, add both of these as **Secret** values:

| Name | Value for practising |
| --- | --- |
| `RESEND_API_KEY` | Your Resend API key |
| `EMAIL_FROM` | `Fancy Knowing <onboarding@resend.dev>` |

Use type Secret for both so Wrangler deployments preserve them. The sender address itself is not confidential, but storing it as a Worker secret prevents configuration redeployments from removing a dashboard-only variable.

`APP_URL` is already set in `wrangler.jsonc` to `https://fancy-knowing.nikki0radz.workers.dev`. This trusted origin is used in recovery links, rather than an address supplied by a visitor. If the app moves to a custom domain, update this config value too.

4. Save/deploy the Worker secret changes.
5. Create a Fancy Knowing account with your Resend account’s email, or sign into your existing account and add that email.
6. Sign out → Forgot password? → enter the email → open the received link → choose and repeat your new password → sign in again. Simple passwords are still accepted.

Do not send the API key or invitation code in chat or commit them to GitHub.

### Sending to your mum or another address

Resend’s `onboarding@resend.dev` test sender can only deliver to the email address on your Resend account. To send to other people:

1. Add a domain you own under Resend → Domains and add the DNS records it provides.
2. Wait for the domain to verify.
3. Change the `EMAIL_FROM` Worker secret to an address on that domain, such as `Fancy Knowing <hello@your-domain.example>` (replace with your actual verified domain).
4. Save/deploy.

You cannot verify ownership of `workers.dev` or use it as your sending domain. The default Worker URL remains fine as the app/recovery-link destination.

Official references:
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/knowledge-base/403-error-resend-dev-domain

## Keeping an existing username account

On sign-in, choose **Have an old username account?** and use the existing username and password. You can then add an email with your current password and confirm the email link. The account’s ID stays the same, so its history, chats, saved bank and settings stay together. The old username login stops once the email is confirmed.

If email delivery is not configured yet, **Do this later** lets you keep using the old account. Add the email later in Settings. Recovery cannot recover an old username account until an email has been attached.

New accounts use email immediately. Sign-up does not force an email-verification step before learning; a successful recovery or email-change link establishes control of that mailbox.

## Behaviour and verification

- Tokens have 256 bits of randomness; only SHA-256 token hashes are stored in D1.
- Reset and email-change links expire after 20 minutes and are single use. Reset links are consumed when a new password is submitted. Email-change links confirm the new address when opened in the app.
- A successful password reset invalidates all other outstanding email links and signs out all existing sessions.
- Reset requests return the same message whether the email exists, preventing account enumeration. Resend failures are logged by status only; unused tokens are removed. If no mail arrives, check spam and the Resend send logs.
- Requests have per-address and per-IP limits. Tokens, passwords and email bodies are not printed in application logs or returned by the API.
- Email changes require the current password and confirmation sent to the new mailbox. Duplicate email addresses are rejected.
- `/api/health` exposes `email: true` when the required email settings exist. This is a configuration check, not proof of successful delivery.
- The automated integration suite uses mocked delivery. Actual mailbox delivery needs the settings above and a user-triggered reset request to verify.

## Personalisation

After sign-up: first name → subject-pill grid. Choose up to 20 interests, add a meaningful niche through **Add**, or keep a general mix. Settings → Edit name & interests can change this later.

Built-in subjects are accepted immediately. Custom topics are checked by AI for coherent learning content; unusual, specific interests are allowed, while gibberish, spam, abuse and dangerous requests are rejected. Custom-topic approval is scoped to the account. The server rejects unchecked topics even if a client tries to bypass the Add button.

A selected subject rotates each day. Questions can be shared between people who receive the same subject on the same day, while each account’s answers/chats/hearts remain separate. Today’s assigned question stays fixed; changing interests affects the next new day, keeping ongoing answers and chats stable.
