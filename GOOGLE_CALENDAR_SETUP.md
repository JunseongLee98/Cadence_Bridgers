# Google Calendar Integration Setup Guide

This guide will help you set up Google Calendar integration for your Cadence app.

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name (e.g., "Cadence Calendar") and click "Create"

## Step 2: Enable Google Calendar API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click on it and press "Enable"

## Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client ID"
3. If prompted, configure the OAuth consent screen:
   - Choose "External" (unless you have a Google Workspace)
   - Fill in the required fields:
     - App name: Cadence
     - User support email: your email
     - Developer contact: your email
     - Application home page: `https://www.bridgerscadence.com`
       (public page that names the app **Cadence** and explains purpose + Google Calendar use; calendar UI lives at `/app`)
     - Privacy policy: `https://www.bridgerscadence.com/privacy`
     - Terms of service: `https://www.bridgerscadence.com/tos`
     - Authorized domains: `bridgerscadence.com`
   - Add scopes needed by the app (at least Calendar scopes you use in production)
   - Add test users (your email) if in testing mode
   - Save and continue through the steps

4. Create OAuth 2.0 Client ID:
   - Application type: "Web application"
   - Name: Cadence Web Client
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback`
     - (For production, add your production URL)

5. Copy the **Client ID** and **Client Secret**

## Step 4: Configure Environment Variables

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` and add your credentials:
   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
   ```

## Step 5: Restart Development Server

After adding environment variables, restart your Next.js server:
```bash
npm run dev
```

## Step 6: Connect Your Calendar

1. Open your app at http://localhost:3000
2. Click "Connect Google Calendar" in the header
3. Sign in with your Google account
4. Grant permissions to read your calendar
5. Your Google Calendar events will now appear in the app!

## Features

- ✅ View your Google Calendar events alongside local events
- ✅ Google events are displayed in blue
- ✅ Auto-refresh to sync latest events
- ✅ Disconnect anytime
- ✅ Tasks scheduled by AI will avoid your Google Calendar events

## Troubleshooting

### "Error: Google Calendar credentials not configured"
- Make sure `.env.local` exists and has all three variables
- Restart your development server after adding environment variables

### "Access denied" or "Invalid client"
- Check that your Client ID and Client Secret are correct
- Verify the redirect URI matches exactly: `http://localhost:3000/api/auth/callback`
- Make sure you've enabled the Google Calendar API

### `invalid_client` / "The provided client secret is invalid"
This means Google does not accept the **client secret** for the **Web application** OAuth client with your `GOOGLE_CLIENT_ID`. It is not a redirect-uri mismatch (that usually fails earlier).

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Open the **Web application** OAuth 2.0 client whose Client ID matches `GOOGLE_CLIENT_ID`
3. If you do not have the current secret, click **Reset secret** (or create a new Web client) and copy the new value
4. Update **both**:
   - Local: `GOOGLE_CLIENT_SECRET` in `.env.local`
   - Production (Vercel): **Project → Settings → Environment Variables** — set `GOOGLE_CLIENT_SECRET` for Production (and Preview if you test there). Also set:
     - `GOOGLE_CLIENT_ID` (same Web client)
     - `GOOGLE_REDIRECT_URI=https://www.bridgerscadence.com/api/auth/callback`
5. **Redeploy** after changing Vercel env vars (a new deployment is required)
6. Confirm locally: `npm run verify:google-oauth` — success prints that credentials are accepted

Use only a **Web application** client secret. Android/iOS/Desktop clients do not use this server-side flow.

### Events not showing up
- Click the refresh button next to "Google Calendar" to sync
- Check browser console for errors
- Verify your Google Calendar has events in the next 30 days

### OAuth consent screen warnings
- If you see "This app isn't verified", click "Advanced" → "Go to [Your App]"
- Add your email as a test user in the OAuth consent screen

## Security Notes

- Never commit `.env.local` to version control (it's in `.gitignore`)
- For production, use environment variables in your hosting platform
- Tokens are stored in browser localStorage (client-side only)

