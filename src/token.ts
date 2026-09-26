import { WebchatError } from './errors.js';
import type { TokenGrant, TokenProvider } from './types.js';

/**
 * The page the widget runs on, so the agent can say where a conversation
 * started. Origin and path only: query strings and fragments often carry
 * search terms, emails or tokens, and none of that is the agent's business.
 * Undefined outside a browser (Node, a worker without `location`).
 */
export function pageUrl(): string | undefined {
  const location = (globalThis as { location?: { protocol?: string; origin?: string; pathname?: string } }).location;
  if (!location?.origin || !/^https?:$/.test(location.protocol ?? '')) return undefined;
  return `${location.origin}${location.pathname ?? '/'}`;
}

/**
 * Default token provider: asks the agent itself for a session token.
 *
 * Fine for a public widget. If you want to decide who may chat, set
 * WEBCHAT_ISSUE_KEY on the agent and mint tokens from your own backend with a
 * custom provider instead — the browser then never sees the issue key.
 */
export function createDefaultTokenProvider(options: {
  headers?: Record<string, string>;
  fetchImpl?: typeof globalThis.fetch;
}): TokenProvider {
  return async ({ url, sessionId, projectToken, userId }) => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new WebchatError(
        'No fetch implementation available; pass `fetch` in the client options.',
        'token_failed',
      );
    }

    const endpoint = `${url.replace(/\/$/, '')}/sessions`;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        // `projectToken` selects the project, and the agent requires it: there
        // is no default project to fall back on.
        body: JSON.stringify({
          ...(sessionId ? { sessionId } : {}),
          ...(projectToken ? { projectToken } : {}),
          ...(userId ? { userId } : {}),
          ...(pageUrl() ? { pageUrl: pageUrl() } : {}),
        }),
      });
    } catch (error) {
      throw new WebchatError(`Could not reach ${endpoint}.`, 'token_failed', { cause: error });
    }

    if (!response.ok) {
      throw new WebchatError(
        `Token request to ${endpoint} failed with ${response.status}.`,
        'token_failed',
      );
    }

    const grant = (await response.json()) as TokenGrant;
    if (typeof grant?.token !== 'string' || grant.token === '') {
      throw new WebchatError(`${endpoint} did not return a token.`, 'token_failed');
    }
    return grant;
  };
}
