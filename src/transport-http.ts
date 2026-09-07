import { WebchatError, toWebchatError } from './errors.js';
import {
  PROTOCOL_VERSION,
  type ChatCancelEvent,
  type ChatCompleteEvent,
  type ChatDeltaEvent,
  type ChatErrorEvent,
  type ChatFeedbackEvent,
  type ChatSendEvent,
  type ChatStartedEvent,
  type ChatToolEvent,
  type SessionReadyEvent,
} from './protocol.js';
import type { Transport, TransportContext } from './transport.js';
import type { TokenGrant } from './types.js';

/** The signed part of a session token, read without verifying — the agent does that. */
function decodeTokenPayload(token: string): { sid?: string; aid?: string } {
  try {
    const encoded = token.split('.')[0] ?? '';
    const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { sid?: unknown; aid?: unknown };
    return {
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
      aid: typeof payload.aid === 'string' ? payload.aid : undefined,
    };
  } catch {
    return {};
  }
}

interface SseFrame {
  event: string;
  data: string;
}

/** Splits a text/event-stream body into frames as they arrive. */
async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];

  const flush = (): SseFrame | undefined => {
    if (data.length === 0) return undefined;
    const frame = { event, data: data.join('\n') };
    event = 'message';
    data = [];
    return frame;
  };

  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        const frame = flush();
        if (frame) yield frame;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (done) {
      const frame = flush();
      if (frame) yield frame;
      return;
    }
  }
}

/**
 * The protocol over plain HTTP: `POST /chat/stream` per turn, answered with
 * Server-Sent Events that carry the same payloads as the socket events.
 *
 * Nothing stays open between turns, so nothing needs a sticky session or a
 * websocket-capable proxy — the transport for Vercel and other hosts that
 * route every request on its own. There is no handshake either: `connect()`
 * mints the token and reports what `POST /sessions` said about the agent.
 */
export class HttpTransport implements Transport {
  private ready = false;
  private inFlight: { id: string; controller: AbortController } | undefined;

  constructor(private readonly ctx: TransportContext) {}

  get connected(): boolean {
    return this.ready;
  }

  async connect(): Promise<SessionReadyEvent> {
    const { ctx } = this;
    // A session the client already knows is one being resumed, and what a
    // cached grant said about it is as old as the grant. A socket learns the
    // current history from its handshake; here a fresh mint for the same
    // session is that handshake. (Nothing cached: this is the first mint anyway.)
    const known = ctx.sessionId();
    const grant = await ctx.token(known ? { fresh: true, sessionId: known } : undefined);
    const payload = decodeTokenPayload(grant.token);
    const sessionId = grant.sessionId ?? payload.sid ?? known;
    if (!sessionId) {
      // A grant that names no session and whose token holds none is one the
      // agent would refuse as malformed; say so here, without a round trip.
      ctx.dropToken();
      throw new WebchatError('The session token is not readable.', 'auth_failed', { agentId: ctx.agentId() });
    }
    const event: SessionReadyEvent = {
      protocolVersion: grant.protocolVersion ?? PROTOCOL_VERSION,
      sessionId,
      agentId: grant.agentId ?? payload.aid ?? ctx.agentId() ?? '',
      agentName: grant.agentName ?? '',
      provider: grant.provider ?? '',
      model: grant.model ?? '',
      historyLength: grant.historyLength ?? 0,
    };
    this.ready = true;
    ctx.handlers.onEvent('session:ready', event);
    return event;
  }

  send(event: ChatSendEvent): void {
    if (this.inFlight) {
      // Same answer the agent gives a socket that sends while it is still
      // answering; saved a round trip.
      this.ctx.handlers.onEvent('chat:error', {
        replyTo: event.id,
        code: 'busy',
        message: 'The agent is still answering the previous message.',
      });
      return;
    }
    const controller = new AbortController();
    this.inFlight = { id: event.id, controller };
    void this.stream(event, controller).finally(() => this.release(controller));
  }

  cancel(_event: ChatCancelEvent): void {
    // Closing the request is the cancel: the agent aborts the turn when the
    // connection goes, and the stream below reports `cancelled`.
    this.inFlight?.controller.abort();
  }

  reset(): void {
    const sessionId = this.ctx.sessionId();
    if (!sessionId) return;
    void this.request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  feedback(event: ChatFeedbackEvent): void {
    void this.request('/chat/feedback', { method: 'POST', body: JSON.stringify(event) }).catch(() => undefined);
  }

  disconnect(): void {
    this.inFlight?.controller.abort();
    this.inFlight = undefined;
    this.ready = false;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Frees the slot for the next turn. Called on the terminal frame, before it
   * is handed on: whoever awaits the reply may send again the moment it
   * resolves, and the response body outlives the `done` frame by a tick.
   */
  private release(controller: AbortController): void {
    if (this.inFlight?.controller === controller) this.inFlight = undefined;
  }

  private async request(path: string, init: { method: string; body?: string; signal?: AbortSignal }): Promise<Response> {
    const grant = await this.ctx.token();
    return this.ctx.fetch(`${this.ctx.url.replace(/\/$/, '')}${path}`, {
      method: init.method,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${grant.token}`,
        ...this.ctx.headers,
      },
      body: init.body,
      signal: init.signal,
    });
  }

  private async stream(event: ChatSendEvent, controller: AbortController): Promise<void> {
    const { handlers } = this.ctx;
    const replyTo = event.id;
    const fail = (error: ChatErrorEvent) => handlers.onEvent('chat:error', error);
    const cancelled = () => controller.signal.aborted;

    let response: Response;
    try {
      response = await this.request('/chat/stream', {
        method: 'POST',
        body: JSON.stringify({ id: replyTo, message: event.text }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof WebchatError) {
        // The token could not be (re)minted; the turn never left.
        handlers.onError(error, replyTo);
        return;
      }
      fail({
        replyTo,
        code: cancelled() ? 'cancelled' : 'agent_error',
        message: cancelled() ? 'The turn was cancelled.' : `Could not reach ${this.ctx.url}.`,
      });
      return;
    }

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
      const message = typeof body.error === 'string' ? body.error : `${this.ctx.url} answered ${response.status}.`;
      if (response.status === 401) {
        // The agent refused the token: forget it, and say so as the socket would.
        this.ctx.dropToken();
        const reason = typeof body.code === 'string' ? body.code : 'bad_signature';
        handlers.onError(toWebchatError(reason, this.ctx.agentId() ?? 'unknown'), replyTo);
        return;
      }
      fail({ replyTo, code: response.status === 409 ? 'busy' : 'agent_error', message });
      return;
    }

    let finished = false;
    try {
      for await (const frame of readFrames(response.body)) {
        const data = JSON.parse(frame.data) as unknown;
        switch (frame.event) {
          case 'started':
            handlers.onEvent('chat:started', data as ChatStartedEvent);
            break;
          case 'delta':
            handlers.onEvent('chat:delta', data as ChatDeltaEvent);
            break;
          case 'tool':
            handlers.onEvent('chat:tool', data as ChatToolEvent);
            break;
          case 'done':
            finished = true;
            this.release(controller);
            handlers.onEvent('chat:complete', data as ChatCompleteEvent);
            break;
          case 'error':
            finished = true;
            this.release(controller);
            fail({ replyTo, ...(data as ChatErrorEvent) });
            break;
          default:
            // `session`, and anything a newer agent adds.
            break;
        }
      }
    } catch (error) {
      if (finished) return;
      finished = true;
      fail({
        replyTo,
        code: cancelled() ? 'cancelled' : 'agent_error',
        message: cancelled() ? 'The turn was cancelled.' : `The reply stream broke: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    if (!finished) {
      // The host closed the response (its max duration, a proxy) before the
      // agent said it was done. What was streamed is on the message already.
      fail({
        replyTo,
        code: cancelled() ? 'cancelled' : 'agent_error',
        message: cancelled() ? 'The turn was cancelled.' : 'The connection closed before the reply finished.',
      });
    }
  }
}

export type { TokenGrant };
