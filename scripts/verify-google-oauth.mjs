/**
 * Verifies GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET against Google's token endpoint.
 * Usage: node scripts/verify-google-oauth.mjs
 * Loads .env.local from the project root when present.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env.local');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(envPath);

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI?.trim() ||
  'http://localhost:3000/api/auth/callback';

if (!clientId || !clientSecret) {
  console.error(
    'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET (set in .env.local or environment).'
  );
  process.exit(1);
}

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: 'verify-credentials-only',
  }),
});

const body = await res.json().catch(() => ({}));

if (body.error === 'invalid_client') {
  console.error(
    'Google rejected these credentials (invalid_client / invalid client secret).'
  );
  console.error(
    'In Google Cloud Console → APIs & Services → Credentials, open the Web OAuth client'
  );
  console.error(`matching this Client ID, reset the client secret, then update:`);
  console.error(`  GOOGLE_CLIENT_ID=${clientId}`);
  console.error('  GOOGLE_CLIENT_SECRET=<new secret from console>');
  console.error(`  GOOGLE_REDIRECT_URI=${redirectUri}`);
  console.error(
    'Set the same values in Vercel (or your host) for production, then redeploy.'
  );
  process.exit(1);
}

if (body.error === 'invalid_grant') {
  console.log(
    'Client ID and secret are accepted by Google (invalid_grant is expected for a dummy refresh token).'
  );
  console.log(`Redirect URI in env: ${redirectUri}`);
  process.exit(0);
}

console.error('Unexpected response from Google:', body);
process.exit(1);
