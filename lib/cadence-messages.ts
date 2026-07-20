/**
 * Messages between Cadence extension UI (panel/options) and the service worker.
 */

export type CadenceMessage =
  | {
      type: 'CADENCE_DECOMPOSE';
      payload: {
        title: string;
        description?: string;
        dueDate?: string;
        stepCount?: number;
        locale?: 'en' | 'ko';
      };
    }
  | {
      type: 'CADENCE_GET_GOOGLE_EVENTS';
      payload: { accessToken: string; timeMin?: string; timeMax?: string };
    }
  | {
      type: 'CADENCE_FETCH_ICS';
      payload: { url: string };
    }
  | {
      type: 'CADENCE_GET_ENV';
      payload?: Record<string, never>;
    }
  | {
      type: 'CADENCE_OAUTH_GOOGLE';
      payload: { clientId: string };
    };

export type CadenceResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
