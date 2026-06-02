# SportsTech Messenger / Leads Setup

This feature replaces basic ManyChat-style keyword automation with a SportsTech-owned Messenger inbox, lead list, and auto-reply rules inside the existing admin dashboard.

## What Was Added

- `messenger_leads`: one row per Facebook Messenger sender/page pair.
- `messenger_messages`: incoming customer messages and outgoing auto-replies.
- `auto_reply_rules`: admin-managed keyword rules used by the webhook.
- Supabase Edge Function `messenger-webhook`: verifies Meta webhooks, stores messages, matches rules, and sends replies.
- Admin module `/admin` > `Messenger / Leads`: lead list, message viewer, lead status/notes, and auto-reply rule manager.

## Required Environment Variables

Set these as Supabase Edge Function secrets. Do not place them in frontend `.env` files or `NEXT_PUBLIC` / `VITE` variables.

```bash
SUPABASE_URL=https://dmmydgioujpablalezsn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
MESSENGER_VERIFY_TOKEN=choose-a-long-random-verify-token
MESSENGER_PAGE_ACCESS_TOKEN=your-facebook-page-access-token
MESSENGER_APP_SECRET=your-meta-app-secret
```

`MESSENGER_APP_SECRET` is used to validate `x-hub-signature-256` on incoming webhook POSTs. The function allows local testing without it, but production should always set it.

## Supabase SQL Setup

Apply the migration:

```bash
supabase migration up
```

Or run the SQL in:

```text
supabase/migrations/202606020001_messenger_leads.sql
```

The tables enable RLS. Authenticated admin users can read leads/messages and manage lead status/notes plus auto-reply rules. The webhook writes with the Supabase service role key inside the Edge Function.

## Deploy The Supabase Edge Function

Login/link if needed:

```bash
supabase login
supabase link --project-ref dmmydgioujpablalezsn
```

Set secrets:

```bash
supabase secrets set SUPABASE_URL=https://dmmydgioujpablalezsn.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
supabase secrets set MESSENGER_VERIFY_TOKEN=choose-a-long-random-verify-token
supabase secrets set MESSENGER_PAGE_ACCESS_TOKEN=your-facebook-page-access-token
supabase secrets set MESSENGER_APP_SECRET=your-meta-app-secret
```

Deploy without JWT verification because Meta cannot send a Supabase user JWT:

```bash
supabase functions deploy messenger-webhook --no-verify-jwt
```

Webhook URL:

```text
https://dmmydgioujpablalezsn.supabase.co/functions/v1/messenger-webhook
```

## Meta Developer App Setup

1. Create or open the Meta app for SportsTech in Meta for Developers.
2. Add the Messenger product.
3. Connect the Facebook Page that receives SportsTech customer messages.
4. Generate a Page Access Token for that page and save it as `MESSENGER_PAGE_ACCESS_TOKEN`.
5. Copy the App Secret and save it as `MESSENGER_APP_SECRET`.
6. In Messenger webhooks, add the callback URL:

```text
https://dmmydgioujpablalezsn.supabase.co/functions/v1/messenger-webhook
```

7. Set Verify Token to the same value as `MESSENGER_VERIFY_TOKEN`.
8. Subscribe to page events:
   - `messages`
   - `messaging_postbacks` if you later add buttons/postbacks
9. Put the app in Live mode after testing and permissions are approved.

## Vercel Deployment

The admin UI is part of the existing Vite app. Deploy normally:

```bash
npm run build
vercel deploy --prod
```

No Messenger secrets are required in Vercel for the current implementation because webhook processing lives in Supabase Edge Functions.

## How Auto-Replies Work

1. A customer sends the Facebook Page a Messenger text.
2. Meta calls the Supabase Edge Function.
3. The function verifies the webhook token or POST signature.
4. The function creates/updates a lead and saves the incoming message.
5. Active rules are loaded from `auto_reply_rules`, sorted by priority.
6. The first matching rule sends its `reply_text` through the Meta Send API.
7. The outgoing reply is saved to `messenger_messages`.

Rules can use:

- `contains`: customer message contains any keyword.
- `exact`: customer message exactly matches a keyword.

Lower priority numbers run first.
