/**
 * Reports what the widget saw to the agent it is already talking to.
 *
 * The server logs its own half of a conversation, but the half that fails
 * hardest is this one: a token request that never came back, a websocket the
 * network would not open, a reply that timed out here. None of that reaches a
 * server log, and it is what you need when a visitor says the chat "didn't
 * work".
 *
 * Three deliberate limits:
 *
 *  - It goes to the agent's own origin, the one this widget already sends every
 *    chat message to. No third party is involved, and embedding the widget does
 *    not quietly enrol a site in someone else's analytics.
 *  - It carries the SDK's own error codes and messages. Never anything the
 *    visitor typed.
 *  - It never throws, never retries and never blocks. Telemetry that can break
 *    the thing it is watching is worse than none.
 */
import type { WebchatErrorCode } from './errors.js';

export interface TelemetryEvent {
  level: 'info' | 'warn' | 'error';
  code: WebchatErrorCode | string;
  message?: string;
  at?: string;
  /** The failing server request, when one was seen, from its x-request-id. */
  requestId?: string;
}

export interface TelemetryOptions {
  /** Base URL of the agent. */
  url: string;
  fetchImpl?: typeof globalThis.fetch;
  /** How long to gather events before sending. */
  debounceMs?: number;
}

/** Matches the server's per-request cap in src/observability/telemetry.ts. */
const MAX_EVENTS = 20;
const DEFAULT_DEBOUNCE_MS = 2_000;

export class TelemetryReporter {
  private queue: TelemetryEvent[] = [];
  private token: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof globalThis.fetch | undefined;
  private readonly debounceMs: number;
  private detachUnload: (() => void) | undefined;

  constructor(options: TelemetryOptions) {
    this.endpoint = `${options.url.replace(/\/+$/, '')}/telemetry/client`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    // A visitor closing the tab is exactly when the interesting failure has
    // just happened, so send before the page goes. `pagehide` is the one that
    // fires reliably on mobile Safari, where `beforeunload` does not.
    if (typeof globalThis.addEventListener === 'function') {
      const onHide = () => this.flush();
      globalThis.addEventListener('pagehide', onHide);
      this.detachUnload = () => globalThis.removeEventListener?.('pagehide', onHide);
    }
  }

  /**
   * The session token to report under. Until one exists there is nothing to
   * attribute events to, so they wait — bounded, like everything else here.
   */
  setToken(token: string | undefined): void {
    this.token = token;
    if (token && this.queue.length > 0) this.schedule();
  }

  report(event: TelemetryEvent): void {
    if (this.closed) return;
    // Drop the oldest rather than grow without bound: a widget in a reconnect
    // loop produces these faster than they can be sent.
    if (this.queue.length >= MAX_EVENTS) this.queue.shift();
    this.queue.push({ at: new Date().toISOString(), ...event });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || !this.token) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.debounceMs);
    // Node only: a pending report must not hold a process open.
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Sends whatever is queued. Safe to call at any time, including on unload. */
  flush(): void {
    if (!this.token || this.queue.length === 0 || !this.fetchImpl) return;
    const events = this.queue.slice(0, MAX_EVENTS);
    this.queue = [];
    try {
      void this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: this.token, events }),
        // Survives the page being torn down, which `sendBeacon` also would —
        // but keepalive lets this be an ordinary CORS request with a real
        // content type, so the agent's existing CORS allowlist covers it.
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Reporting a failure must never itself become one.
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flush();
    this.detachUnload?.();
    this.detachUnload = undefined;
  }
}
