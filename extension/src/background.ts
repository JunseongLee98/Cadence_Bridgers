/**
 * Cadence extension service worker — API routes + Google OAuth for the panel on Calendar.
 */
import { decomposeAssignment, type DecomposeEnv } from '../../lib/decompose-assignment';
import { fetchGoogleCalendarEventsRest } from '../../lib/google-calendar-rest';
import type { CadenceMessage } from '../../lib/cadence-messages';

/** LLM keys in chrome.storage.local */
const STORAGE = {
  openaiApiKey: 'cadence_openai_api_key',
  ollamaBaseUrl: 'cadence_ollama_base_url',
  ollamaModel: 'cadence_ollama_model',
  ollamaApiKey: 'cadence_ollama_api_key',
  googleOAuthClientId: 'cadence_google_oauth_client_id',
} as const;

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
].join(' ');

async function loadDecomposeEnv(): Promise<DecomposeEnv> {
  const data = await chrome.storage.local.get([
    STORAGE.openaiApiKey,
    STORAGE.ollamaBaseUrl,
    STORAGE.ollamaModel,
    STORAGE.ollamaApiKey,
  ]);
  return {
    openaiApiKey: data[STORAGE.openaiApiKey] as string | undefined,
    ollamaBaseUrl: data[STORAGE.ollamaBaseUrl] as string | undefined,
    ollamaModel: data[STORAGE.ollamaModel] as string | undefined,
    ollamaApiKey: data[STORAGE.ollamaApiKey] as string | undefined,
  };
}

function extensionRedirectUri(): string {
  return `https://${chrome.runtime.id}.chromiumapp.org`;
}

async function oauthGoogleImplicit(clientId: string): Promise<{ access_token: string; expires_in?: string }> {
  const redirectUri = extensionRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: CALENDAR_SCOPES,
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!responseUrl) {
        reject(new Error('No redirect URL'));
        return;
      }
      try {
        const url = new URL(responseUrl);
        const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
        const parsed = new URLSearchParams(hash);
        const access_token = parsed.get('access_token');
        const error = parsed.get('error');
        if (error) {
          reject(new Error(parsed.get('error_description') || error));
          return;
        }
        if (!access_token) {
          reject(new Error('No access_token in redirect. Add this redirect URI in Google Cloud: ' + redirectUri));
          return;
        }
        resolve({
          access_token,
          expires_in: parsed.get('expires_in') || undefined,
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

async function handleMessage(msg: CadenceMessage): Promise<unknown> {
  switch (msg.type) {
    case 'CADENCE_GET_ENV': {
      return loadDecomposeEnv();
    }
    case 'CADENCE_DECOMPOSE': {
      const env = await loadDecomposeEnv();
      return decomposeAssignment(msg.payload, env);
    }
    case 'CADENCE_GET_GOOGLE_EVENTS': {
      const { accessToken, timeMin, timeMax } = msg.payload;
      if (!accessToken) {
        throw new Error('accessToken is required');
      }
      const events = await fetchGoogleCalendarEventsRest(
        accessToken,
        timeMin ? new Date(timeMin) : undefined,
        timeMax ? new Date(timeMax) : undefined
      );
      return { events };
    }
    case 'CADENCE_FETCH_ICS': {
      const { url } = msg.payload;
      if (!url) {
        throw new Error('url is required');
      }
      const target = new URL(url);
      if (target.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs are allowed');
      }
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Cadence Chrome Extension' },
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch calendar: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      return { body: text };
    }
    case 'CADENCE_OAUTH_GOOGLE': {
      const { clientId } = msg.payload;
      if (!clientId?.trim()) {
        throw new Error('OAuth Client ID is required. Set it in Cadence extension options.');
      }
      await chrome.storage.local.set({ [STORAGE.googleOAuthClientId]: clientId.trim() });
      const tokens = await oauthGoogleImplicit(clientId.trim());
      await chrome.storage.local.set({
        cadence_google_tokens: JSON.stringify({ access_token: tokens.access_token }),
      });
      return { ok: true };
    }
    default:
      throw new Error(`Unknown message type: ${(msg as { type?: string }).type ?? 'undefined'}`);
  }
}

chrome.runtime.onMessage.addListener(
  (message: CadenceMessage, _sender, sendResponse: (r: unknown) => void) => {
    handleMessage(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: Error) =>
        sendResponse({
          ok: false,
          error: err?.message || String(err),
        })
      );
    return true;
  }
);
