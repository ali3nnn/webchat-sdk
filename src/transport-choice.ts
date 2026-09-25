import { WebchatError } from './errors.js';
import type { WebchatTransportName } from './types.js';

/** Every value `transport` accepts. Leaving it out is the fourth choice: auto. */
export const TRANSPORT_NAMES: readonly WebchatTransportName[] = ['websocket', 'polling', 'http'];

export function isTransportName(value: unknown): value is WebchatTransportName {
  return typeof value === 'string' && (TRANSPORT_NAMES as readonly string[]).includes(value);
}

/** What the client actually builds for a given `transport`. */
export type TransportPlan =
  | { kind: 'http' }
  | { kind: 'socket'; socketTransports: ('websocket' | 'polling')[] };

export function planTransport(transport: WebchatTransportName | undefined): TransportPlan {
  switch (transport) {
    case 'http':
      return { kind: 'http' };
    case 'websocket':
      return { kind: 'socket', socketTransports: ['websocket'] };
    case 'polling':
      return { kind: 'socket', socketTransports: ['polling'] };
    default:
      // Auto: a websocket, falling back to long-polling where one cannot open.
      return { kind: 'socket', socketTransports: ['websocket', 'polling'] };
  }
}

const EXPECTED = 'Use transport: "websocket", "polling" or "http" — or leave it out to let the agent decide.';

let warnedLegacy = false;

/**
 * Reads the transport a caller asked for, as one of the three names or
 * `undefined` for auto, and refuses anything else with a message that says
 * what to write instead — a typo here used to surface much later as a
 * connection that never opened, or as a crash inside socket.io.
 *
 * Two older spellings keep working, because embed snippets already on
 * customers' pages carry them:
 *   - `transport: "socket"` — the socket.io default, i.e. auto;
 *   - `transports: [...]`, socket.io's own list, which the snippet used to pin
 *     (`["polling"]`). A single entry becomes that transport; both are auto.
 */
export function readTransportOption(options: { transport?: unknown; transports?: unknown }): WebchatTransportName | undefined {
  const { transport, transports } = options;

  // "socket" says only "not http", so an old `transports` pin still applies.
  if (transport !== undefined && transport !== null && transport !== '' && transport !== 'socket') {
    if (isTransportName(transport)) return transport;
    throw new WebchatError(`Unknown transport ${JSON.stringify(transport)}. ${EXPECTED}`, 'invalid_options');
  }

  if (transports === undefined || transports === null) return undefined;

  if (!Array.isArray(transports)) {
    const hint = isTransportName(transports) ? ` Did you mean transport: ${JSON.stringify(transports)}?` : '';
    throw new WebchatError(`The \`transports\` option is no longer supported.${hint} ${EXPECTED}`, 'invalid_options');
  }
  const unknown = transports.filter((entry) => entry !== 'websocket' && entry !== 'polling');
  if (unknown.length > 0 || transports.length === 0) {
    throw new WebchatError(
      `The \`transports\` option is no longer supported (and ${JSON.stringify(transports)} was not a valid list). ${EXPECTED}`,
      'invalid_options',
    );
  }
  if (!warnedLegacy && typeof console !== 'undefined') {
    warnedLegacy = true;
    console.warn(`webchat: \`transports\` is deprecated and will be removed. ${EXPECTED}`);
  }
  const unique = [...new Set(transports as ('websocket' | 'polling')[])];
  return unique.length === 1 ? unique[0] : undefined;
}
