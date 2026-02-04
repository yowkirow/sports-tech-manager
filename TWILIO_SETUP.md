# Twilio SMS Setup Guide

This guide explains how to deploy the `send-tracking-sms` function to Supabase so your customers receive SMS notifications when a tracking number is added.

## Prerequisites
1.  **Twilio Account**: You need an Account SID, Auth Token, and a Twilio Phone Number.
2.  **Supabase CLI**: Ensure you have the Supabase CLI installed. If not, run `npm install -g supabase`.

## Steps

### 1. Set Twilio Secrets in Supabase
Run the following commands in your terminal (replace values with your actual Twilio credentials):

```bash
npx supabase secrets set TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
npx supabase secrets set TWILIO_AUTH_TOKEN=040b163fc9f16f4420354b2803051a33
npx supabase secrets set TWILIO_PHONE_NUMBER="+15076363126"
```

### 2. Deploy the Function
Run this command to deploy the function to your Supabase project:

```bash
npx supabase functions deploy send-tracking-sms --no-verify-jwt
```
*Note: `--no-verify-jwt` is used here to allow the frontend to call it easily, but in production, you might want to enforce authentication.*

### 3. Verify
1.  Open your app.
2.  Go to **Orders**.
3.  Add a tracking number to an order that has a valid `contactNumber`.
4.  You should see a toast: **"Tracking saved & SMS sent!"**.

## Troubleshooting

### Error: "Message cannot be sent with the current combination..."
This usually means **Geo-Permissions** are blocking SMS to the Philippines.
1.  Log in to [Twilio Console](https://console.twilio.com/).
2.  Search for **"Geo permissions"** or go to **Messaging > Settings > Geo permissions**.
3.  Filter for **"Philippines"** (or your target country).
4.  **Check the box** to enable SMS to that country.
5.  Save settings and try again.

### Other Common Errors
-   **"Unverified number"**: On a Trial account, you must verify the "To" phone number in Twilio first.
-   **SMS Failed**: Check the browser console or Supabase Function logs.
-   **Invalid Number**: Ensure `contactNumber` is in E.164 format (e.g., `+639...`) or a format Twilio accepts.
