import { Emitter } from './emitter.js';
import { WebchatError } from './errors.js';
import {
  PROTOCOL_VERSION,
  type ChatCompleteEvent,
  type ChatDeltaEvent,
  type ChatErrorEvent,
  type ChatStartedEvent,
  type ChatToolEvent,
  type SessionReadyEvent,
} from './protocol.js';
import { createDefaultTokenProvider, pageUrl } from './token.js';
import { HttpTransport } from './transport-http.js';
import { SocketTransport } from './transport-socket.js';
import { planTransport, readTransportOption } from './transport-choice.js';
import type { ServerEvent, ServerEventName, Transport, TransportContext } from './transport.js';
import type {
  TokenGrant,
  TokenProvider,
  WebchatClientOptions,
  WebchatEvents,
  WebchatMessage,
  WebchatStatus,
} from './types.js';

interface PendingTurn {
  resolve: (message: WebchatMessage) => void;
  reject: (error: WebchatError) => void;
  timer: ReturnType<typeof setTimeout>;
  messageId?: string;
}

/** A message waiting for its turn. The head of the queue is the one being answered. */
interface QueuedTurn {
  id: string;
  text: string;
  resolve: (message: WebchatMessage) => void;
  reject: (error: unknown) => void;
}

/** How soon a turn the agent refused as `busy` is offered again. */
const BUSY_RETRY_MS = 500;

/**
 * How long before `expiresAt` a grant stops being reused. A token that expires
 * between the check and the agent's verification is refused, and a refused
 * handshake costs a whole reconnect attempt.
 */
const TOKEN_EXPIRY_SKEW_MS = 30_000;

/**
 * Whether a grant is too close to its expiry to be worth presenting.
 *
 * The margin never eats more than half the token's life, so an agent configured
 * with a very short WEBCHAT_TOKEN_TTL does not put every connect attempt through
 * a fresh mint — a reconnect storm would then hammer `POST /sessions`.
 */
function isSpent(grant: TokenGrant, mintedAt: number): boolean {
  // A token handed in by the caller may not say when it expires; use it as given.
  if (!grant.expiresAt) return false;
  const expiresAt = Date.parse(grant.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  const margin = Math.min(TOKEN_EXPIRY_SKEW_MS, (expiresAt - mintedAt) / 2);
  return expiresAt - Date.now() <= margin;
}

function randomId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One conversation with one ai-agent instance.
 *
 * The agent mints a session token over HTTP; this client presents it to the
 * agent and then speaks the protocol in ./protocol.ts — over socket.io, or over
 * one HTTP request per turn (`transport: 'http'`), the transcript and events
 * being the same either way. Point several clients at several agent
 * containers — only the URL and token differ. `WebchatHub` does exactly that
 * for you.
 */
export class WebchatClient extends Emitter<WebchatEvents> {
  private readonly options: WebchatClientOptions;
  private readonly tokenProvider: TokenProvider;
  private transport: Transport | undefined;
  private grant: TokenGrant | undefined;
  /** When `grant` was obtained, so its remaining life can be judged. */
  private grantMintedAt = 0;
  /**
   * The conversation this client is having, remembered independently of the
   * grant: a token that expires is replaced, and the replacement must be minted
   * for the same session or the visitor loses their history.
   */
  private knownSessionId: string | undefined;
  private connectPromise: Promise<SessionReadyEvent> | undefined;
  private session: SessionReadyEvent | undefined;
  private state: WebchatStatus = 'idle';
  private readonly transcript: WebchatMessage[] = [];
  /** Keyed by the client-generated id we sent as `chat:send.id`. */
  private readonly pending = new Map<string, PendingTurn>();
  /** The agent answers one message at a time; the rest wait here, in order. */
  private readonly queue: QueuedTurn[] = [];
  private draining = false;
  private destroyed = false;

  constructor(options: WebchatClientOptions) {
    super();
    // Validated here, not at connect time: a typo in `transport` should fail
    // where it was written, not as a connection that silently never opens.
    // The legacy `transports` list is folded into `transport` and dropped.
    const { transports: _legacy, ...rest } = options as WebchatClientOptions & { transports?: unknown };
    this.options = { ...rest, transport: readTransportOption(options as { transport?: unknown; transports?: unknown }) };
    this.grant = options.token ? { token: options.token } : undefined;
    this.grantMintedAt = Date.now();
    this.knownSessionId = options.sessionId;
    this.tokenProvider =
      options.tokenProvider ??
      createDefaultTokenProvider({ headers: options.headers, fetchImpl: options.fetch });

    if (options.autoConnect) void this.connect().catch(() => undefined);
  }

  get status(): WebchatStatus {
    return this.state;
  }

  /** The agent's handshake details, once connected. */
  get info(): SessionReadyEvent | undefined {
    return this.session;
  }

  /** The project the agent identified itself as, once a token or handshake says so. */
  get agentId(): string | undefined {
    return this.session?.agentId ?? this.grant?.agentId;
  }

  get sessionId(): string | undefined {
    return (
      this.session?.sessionId ??
      this.grant?.sessionId ??
      this.knownSessionId ??
      this.options.sessionId
    );
  }

  /** A copy of the transcript held by this client. */
  get messages(): WebchatMessage[] {
    return this.transcript.map((message) => ({ ...message, tools: [...message.tools] }));
  }

  async connect(): Promise<SessionReadyEvent> {
    if (this.destroyed) {
      throw new WebchatError('This client has been destroyed.', 'connect_failed');
    }
    if (this.session && this.transport?.connected) return this.session;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.open().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  /**
   * Sends a message and resolves with the completed assistant reply.
   *
   * A message sent while another is being answered shows in the transcript at
   * once and goes to the agent when that reply has finished, in order.
   */
  async send(text: string): Promise<WebchatMessage> {
    const trimmed = text.trim();
    if (trimmed === '') {
      throw new WebchatError('Cannot send an empty message.', 'invalid_message');
    }

    const id = randomId();
    // `pending` until it leaves: a page reloaded before then has not sent it,
    // so it is not one to bring back as said (the widget stores only finished messages).
    this.upsert({
      id,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
      status: 'pending',
      tools: [],
    });

    return new Promise<WebchatMessage>((resolve, reject) => {
      this.queue.push({ id, text: trimmed, resolve, reject });
      void this.drain();
    });
  }

  /** Asks the agent to stop the turn in progress. */
  cancel(): void {
    this.transport?.cancel({});
  }

  /** Clears the conversation on the agent and locally. */
  reset(): void {
    this.transport?.reset();
    this.transcript.length = 0;
    this.failPending(new WebchatError('The conversation was reset.', 'cancelled'));
  }

  /**
   * Starts over with a brand-new session id: disconnects, forgets the token
   * and the transcript. The next `connect()` mints a fresh session.
   */
  newSession(): void {
    this.reset();
    this.disconnect();
    this.grant = undefined;
    this.knownSessionId = undefined;
    this.options.sessionId = undefined;
  }

  /** Rates an assistant message; `null` clears the rating. */
  feedback(messageId: string, rating: 'up' | 'down' | null): void {
    const message = this.find(messageId);
    if (message) {
      message.feedback = rating;
      this.emit('message', { ...message, tools: [...message.tools] });
    }
    this.transport?.feedback({ messageId, rating });
  }

  /**
   * Seeds the local transcript with messages saved earlier (the widget keeps
   * them in localStorage), so a visitor sees their conversation on every page.
   */
  restore(messages: WebchatMessage[]): void {
    for (const message of messages) {
      if (this.find(message.id)) continue;
      this.transcript.push({ ...message, tools: [...(message.tools ?? [])] });
    }
  }

  disconnect(): void {
    this.failPending(new WebchatError('The client disconnected.', 'disconnected'));
    this.transport?.disconnect();
    this.transport = undefined;
    this.session = undefined;
    this.setStatus('disconnected');
  }

  /** Disconnects and drops every listener. The client cannot be reused. */
  destroy(): void {
    this.destroyed = true;
    this.disconnect();
    this.removeAllListeners();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Works through the queue, one finished turn at a time. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    for (let turn = this.queue[0]; turn; turn = this.queue[0]) {
      try {
        turn.resolve(await this.runTurn(turn));
      } catch (error) {
        turn.reject(error);
      }
      if (this.queue[0] === turn) this.queue.shift();
    }
    this.draining = false;
  }

  /**
   * One message, from connecting to the finished reply. The reply's time limit
   * starts here, not when the message joined the queue. A `busy` is not the
   * visitor's problem: the agent is finishing a turn the client has already let
   * go of, or one from another tab of the same conversation.
   */
  private async runTurn(turn: QueuedTurn): Promise<WebchatMessage> {
    const timeoutMs = this.options.replyTimeoutMs ?? 120_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await this.connect();
      } catch (error) {
        // Nothing behind this message can get through either.
        if (this.queue[0] === turn) this.failQueue(error);
        throw error;
      }
      const transport = this.transport;
      if (!transport) {
        throw new WebchatError('Not connected.', 'disconnected', { agentId: this.agentId });
      }
      // Reset or disconnected while connecting: already rejected, must not leave.
      if (this.queue[0] !== turn) {
        throw new WebchatError('The conversation was reset.', 'cancelled');
      }

      const message = this.find(turn.id);
      if (message?.status === 'pending') {
        message.status = 'complete';
        this.emit('message', { ...message, tools: [...message.tools] });
      }

      try {
        return await this.dispatch(turn, transport, Math.max(deadline - Date.now(), 0));
      } catch (error) {
        const busy = error instanceof WebchatError && error.code === 'busy';
        if (!busy || Date.now() + BUSY_RETRY_MS >= deadline) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
      if (this.queue[0] !== turn) {
        throw new WebchatError('The conversation was reset.', 'cancelled');
      }
    }
  }

  private dispatch(turn: QueuedTurn, transport: Transport, timeoutMs: number): Promise<WebchatMessage> {
    return new Promise<WebchatMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const messageId = this.pending.get(turn.id)?.messageId;
        this.pending.delete(turn.id);
        // The agent would otherwise stay busy with a reply nobody awaits, and
        // the next message in the queue would wait on it.
        transport.cancel({});
        const text = 'The agent did not finish the reply in time.';
        const message = messageId ? this.find(messageId) : undefined;
        if (message) {
          message.status = 'error';
          message.error = text;
          message.errorCode = 'timeout';
          this.emit('message', { ...message, tools: [...message.tools] });
        }
        reject(new WebchatError(text, 'timeout', { agentId: this.agentId, messageId }));
      }, timeoutMs);

      this.pending.set(turn.id, { resolve, reject, timer });
      const page = pageUrl();
      transport.send({ id: turn.id, text: turn.text, ...(page ? { pageUrl: page } : {}) });
    });
  }

  private failQueue(error: unknown): void {
    for (const turn of this.queue.splice(0)) turn.reject(error);
  }

  private async open(): Promise<SessionReadyEvent> {
    this.setStatus('connecting');
    const transport = this.createTransport();
    this.transport = transport;
    try {
      const event = await transport.connect();
      // The handshake handler below may have hung up on a mismatch.
      if (!this.session || this.transport !== transport) {
        throw new WebchatError(
          `Connected to agent "${event.agentId}" but "${this.grant?.agentId ?? 'another'}" was expected.`,
          'agent_mismatch',
          { agentId: event.agentId },
        );
      }
      return event;
    } catch (error) {
      if (this.transport === transport) {
        transport.disconnect();
        this.transport = undefined;
        this.setStatus('disconnected');
      }
      throw error;
    }
  }

  /**
   * The transport is chosen when the conversation opens, not when the client
   * is made: the widget learns the agent's preference from GET /widget/config
   * in between, so a deployment can move to HTTP without every embed changing.
   */
  private createTransport(): Transport {
    // Called as a plain function: a browser's `fetch` refuses to run as a
    // method of anything but `window` ("Illegal invocation").
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const ctx: TransportContext = {
      url: this.options.url,
      token: (options) => this.resolveToken(options),
      dropToken: () => {
        this.grant = undefined;
      },
      sessionId: () => this.sessionId,
      agentId: () => this.agentId,
      fetch: (input, init) => fetchImpl(input, init),
      headers: this.options.headers,
      handlers: {
        onEvent: (name, event) => this.handle(name, event),
        onStatus: (status) => this.setStatus(status),
        onDisconnected: (reason) => {
          this.session = undefined;
          this.setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
          this.failPending(
            new WebchatError(`Disconnected from the agent (${reason}).`, 'disconnected', {
              agentId: this.agentId,
            }),
          );
        },
        onError: (error, replyTo) => {
          this.emit('error', error);
          const turn = replyTo ? this.pending.get(replyTo) : undefined;
          if (turn && replyTo) {
            clearTimeout(turn.timer);
            this.pending.delete(replyTo);
            turn.reject(error);
          }
        },
      },
    };
    const plan = planTransport(this.options.transport);
    return plan.kind === 'http' ? new HttpTransport(ctx) : new SocketTransport(this.options, ctx, plan.socketTransports);
  }

  private async resolveToken(options: { fresh?: boolean; sessionId?: string } = {}): Promise<TokenGrant> {
    const cached = this.grant?.token && !isSpent(this.grant, this.grantMintedAt) ? this.grant : undefined;
    if (cached && !options.fresh) return cached;

    try {
      const grant = await this.tokenProvider({
        projectToken: this.options.projectToken,
        url: this.options.url,
        sessionId: options.sessionId ?? this.sessionId,
        userId: this.options.userId,
      });
      this.grant = grant;
      this.grantMintedAt = Date.now();
      if (grant.sessionId) this.knownSessionId = grant.sessionId;
      return grant;
    } catch (error) {
      // A refresh that fails leaves a usable grant in hand; a first mint does not.
      if (cached) return cached;
      const failure =
        error instanceof WebchatError
          ? error
          : new WebchatError('Could not obtain a session token.', 'token_failed', {
              agentId: this.agentId,
              cause: error,
            });
      this.emit('error', failure);
      throw failure;
    }
  }

  /** One protocol event from the agent, whichever transport carried it. */
  private handle<K extends ServerEventName>(name: K, event: ServerEvent<K>): void {
    switch (name) {
      case 'session:ready':
        this.onReady(event as SessionReadyEvent);
        break;
      case 'chat:started':
        this.onStarted(event as ChatStartedEvent);
        break;
      case 'chat:delta':
        this.onDelta(event as ChatDeltaEvent);
        break;
      case 'chat:tool':
        this.onTool(event as ChatToolEvent);
        break;
      case 'chat:complete':
        this.onComplete(event as ChatCompleteEvent);
        break;
      case 'chat:error':
        this.onError(event as ChatErrorEvent);
        break;
      default:
        break;
    }
  }

  private onReady(event: SessionReadyEvent): void {
    this.session = event;
    this.knownSessionId = event.sessionId;
    this.setStatus('connected');

    if (event.protocolVersion !== PROTOCOL_VERSION) {
      this.emit(
        'error',
        new WebchatError(
          `Agent speaks protocol v${event.protocolVersion}, this SDK speaks v${PROTOCOL_VERSION}.`,
          'protocol_mismatch',
          { agentId: event.agentId },
        ),
      );
    }
    // The grant says which project the token was minted for; an agent that
    // reports another one is not the agent this token belongs to.
    const expected = this.grant?.agentId;
    if (expected && event.agentId && expected !== event.agentId) {
      this.emit(
        'error',
        new WebchatError(
          `Connected to agent "${event.agentId}" but "${expected}" was expected.`,
          'agent_mismatch',
          { agentId: event.agentId },
        ),
      );
      this.disconnect();
      return;
    }
    this.emit('ready', event);
  }

  private onStarted(event: ChatStartedEvent): void {
    const turn = this.pending.get(event.replyTo);
    if (turn) turn.messageId = event.messageId;
    this.upsert({
      id: event.messageId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
      tools: [],
    });
  }

  private onDelta(event: ChatDeltaEvent): void {
    const message = this.find(event.messageId);
    if (!message) return;
    message.text += event.text;
    this.emit('delta', { messageId: event.messageId, text: event.text });
    this.emit('message', { ...message, tools: [...message.tools] });
  }

  private onTool(event: ChatToolEvent): void {
    const message = this.find(event.messageId);
    if (!message) return;
    const existing = message.tools.find((tool) => tool.toolCallId === event.toolCallId);
    const activity = {
      toolCallId: event.toolCallId,
      name: event.name,
      status: event.status,
      input: event.input ?? existing?.input,
      output: event.output ?? existing?.output,
      error: event.error ?? existing?.error,
    };
    if (existing) Object.assign(existing, activity);
    else message.tools.push(activity);

    this.emit('tool', { ...activity, messageId: event.messageId });
    this.emit('message', { ...message, tools: [...message.tools] });
  }

  private onComplete(event: ChatCompleteEvent): void {
    const message = this.find(event.messageId);
    if (message) {
      // Trust the server's accumulated text over the deltas we stitched.
      message.text = event.text || message.text;
      message.status = 'complete';
      message.usage = event.usage;
      this.emit('message', { ...message, tools: [...message.tools] });
      this.emit('complete', { ...message, tools: [...message.tools] });
    }

    const turn = this.pending.get(event.replyTo);
    if (turn && message) {
      clearTimeout(turn.timer);
      this.pending.delete(event.replyTo);
      turn.resolve({ ...message, tools: [...message.tools] });
    }
  }

  private onError(event: ChatErrorEvent): void {
    const turn = event.replyTo ? this.pending.get(event.replyTo) : undefined;
    // A stream that broke is reported without a message id, but the turn knows
    // which reply it was: that bubble must not keep its typing dots.
    const messageId = event.messageId ?? turn?.messageId;
    const message = messageId ? this.find(messageId) : undefined;
    if (message) {
      message.status = 'error';
      message.error = event.message;
      message.errorCode = event.code;
      this.emit('message', { ...message, tools: [...message.tools] });
    }

    const code = event.code === 'agent_error' ? 'agent_error' : event.code;
    const failure = new WebchatError(event.message, code, {
      agentId: this.agentId,
      messageId,
    });
    // A `busy` on a turn in hand is retried (see runTurn), not news.
    if (!(turn && event.code === 'busy')) this.emit('error', failure);

    if (turn && event.replyTo) {
      clearTimeout(turn.timer);
      this.pending.delete(event.replyTo);
      turn.reject(failure);
    }
  }

  private find(messageId: string): WebchatMessage | undefined {
    return this.transcript.find((message) => message.id === messageId);
  }

  private upsert(message: WebchatMessage): void {
    const existing = this.find(message.id);
    if (existing) Object.assign(existing, message);
    else this.transcript.push(message);
    this.emit('message', { ...message, tools: [...message.tools] });
  }

  private failPending(error: WebchatError): void {
    for (const [id, turn] of this.pending) {
      clearTimeout(turn.timer);
      this.pending.delete(id);
      // A reply cut off here gets no `chat:error`, so it must not keep streaming.
      // (After reset() the transcript is empty and there is nothing to mark.)
      const message = turn.messageId ? this.find(turn.messageId) : undefined;
      if (message) {
        message.status = 'error';
        message.error = error.message;
        message.errorCode = error.code;
        this.emit('message', { ...message, tools: [...message.tools] });
      }
      const failure = message ? new WebchatError(error.message, error.code, { ...error.details, messageId: message.id }) : error;
      turn.reject(failure);
      // It is still at the head of the queue; its caller must hear this version, not failQueue's.
      this.queue.find((queued) => queued.id === id)?.reject(failure);
    }
    this.failQueue(error);
  }

  private setStatus(status: WebchatStatus): void {
    if (this.state === status) return;
    this.state = status;
    this.emit('status', status);
  }
}

export function createWebchatClient(options: WebchatClientOptions): WebchatClient {
  return new WebchatClient(options);
}
