import { io, type Socket } from 'socket.io-client';
import { Emitter } from './emitter.js';
import { WebchatError, isAuthFailure, toWebchatError } from './errors.js';
import {
  PROTOCOL_VERSION,
  type ChatCompleteEvent,
  type ChatDeltaEvent,
  type ChatErrorEvent,
  type ChatStartedEvent,
  type ChatToolEvent,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SessionReadyEvent,
} from './protocol.js';
import { createDefaultTokenProvider } from './token.js';
import type {
  TokenGrant,
  TokenProvider,
  WebchatClientOptions,
  WebchatEvents,
  WebchatMessage,
  WebchatStatus,
} from './types.js';

type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface PendingTurn {
  resolve: (message: WebchatMessage) => void;
  reject: (error: WebchatError) => void;
  timer: ReturnType<typeof setTimeout>;
  messageId?: string;
}

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
 * The agent mints a session token over HTTP; this client presents it in the
 * socket.io handshake and then speaks the protocol in ./protocol.ts. Point
 * several clients at several agent containers — the transport is identical, only
 * the URL and token differ. `WebchatHub` does exactly that for you.
 */
export class WebchatClient extends Emitter<WebchatEvents> {
  private readonly options: WebchatClientOptions;
  private readonly tokenProvider: TokenProvider;
  private socket: AgentSocket | undefined;
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
  private destroyed = false;

  constructor(options: WebchatClientOptions) {
    super();
    this.options = options;
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
    if (this.session && this.socket?.connected) return this.session;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openSocket().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  /** Sends a message and resolves with the completed assistant reply. */
  async send(text: string): Promise<WebchatMessage> {
    const trimmed = text.trim();
    if (trimmed === '') {
      throw new WebchatError('Cannot send an empty message.', 'invalid_message');
    }

    await this.connect();
    const socket = this.socket;
    if (!socket) {
      throw new WebchatError('Not connected.', 'disconnected', { agentId: this.agentId });
    }

    const id = randomId();
    this.upsert({
      id,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
      status: 'complete',
      tools: [],
    });

    return new Promise<WebchatMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new WebchatError(
            'The agent did not finish the reply in time.',
            'timeout',
            { agentId: this.agentId },
          ),
        );
      }, this.options.replyTimeoutMs ?? 120_000);

      this.pending.set(id, { resolve, reject, timer });
      socket.emit('chat:send', { id, text: trimmed });
    });
  }

  /** Asks the agent to stop the turn in progress. */
  cancel(): void {
    this.socket?.emit('chat:cancel', {});
  }

  /** Clears the conversation on the agent and locally. */
  reset(): void {
    this.socket?.emit('chat:reset');
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
    this.socket?.emit('chat:feedback', { messageId, rating });
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
    this.socket?.disconnect();
    this.socket = undefined;
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

  private async openSocket(): Promise<SessionReadyEvent> {
    this.setStatus('connecting');
    // Fail fast with a clear error if the token cannot be obtained at all.
    const grant = await this.resolveToken();

    const socket: AgentSocket = io(this.options.url, {
      path: this.options.socketPath ?? '/webchat',
      // Correlation only. The handshake URL is otherwise identical for every
      // visitor, which leaves a connection impossible to find again in an
      // access log or a HAR file. The agent authenticates the signed token in
      // the socket.io auth payload and never reads these.
      query: this.correlationQuery(grant),
      transports: this.options.transports ?? ['websocket', 'polling'],
      reconnection: this.options.reconnection ?? true,
      reconnectionAttempts: this.options.reconnectionAttempts ?? Infinity,
      autoConnect: false,
      // socket.io calls this before every (re)connect attempt, so an expired
      // token is replaced transparently on reconnection.
      auth: (cb: (data: Record<string, unknown>) => void) => {
        this.resolveToken().then(
          (grant) => cb({ token: grant.token }),
          () => cb({}),
        );
      },
    });

    this.socket = socket;
    this.bind(socket);

    return new Promise<SessionReadyEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.close();
        reject(
          new WebchatError(
            `Timed out connecting to ${this.options.url}.`,
            'timeout',
            { agentId: this.agentId },
          ),
        );
      }, this.options.connectTimeoutMs ?? 30_000);

      const onReady = (event: SessionReadyEvent) => {
        cleanup();
        resolve(event);
      };
      const onError = (error: Error) => {
        const failure = toWebchatError(error.message, this.agentId ?? 'unknown');
        // An auth failure never fixes itself by retrying with the same token.
        if (isAuthFailure(error.message)) {
          this.grant = undefined;
          cleanup();
          socket.close();
          reject(failure);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        socket.off('session:ready', onReady);
        socket.off('connect_error', onError);
      };

      socket.on('session:ready', onReady);
      socket.on('connect_error', onError);
      socket.connect();
    });
  }

  /**
   * Non-secret ids for the handshake URL. Anyone can put anything here, so the
   * agent trusts none of it — it exists so proxies, CDNs and browser HARs, which
   * see only the URL, can say which session and project a socket belonged to.
   *
   * Spell the names out: `sid`, `t`, `j`, `b64`, `EIO` and `transport` belong to
   * Engine.IO. A `sid` of our own is read as its polling session id and the
   * handshake is refused with "Session ID unknown".
   */
  private correlationQuery(grant: TokenGrant): Record<string, string> | undefined {
    if (this.options.correlationIds === false) return undefined;
    const query: Record<string, string> = {};
    const sessionId = grant.sessionId ?? this.sessionId;
    const agentId = grant.agentId ?? this.agentId;
    if (sessionId) query.sessionId = sessionId;
    if (agentId) query.agentId = agentId;
    return Object.keys(query).length > 0 ? query : undefined;
  }

  private async resolveToken(): Promise<TokenGrant> {
    if (this.grant?.token && !isSpent(this.grant, this.grantMintedAt)) return this.grant;

    try {
      const grant = await this.tokenProvider({
        projectToken: this.options.projectToken,
        url: this.options.url,
        sessionId: this.sessionId,
        userId: this.options.userId,
      });
      this.grant = grant;
      this.grantMintedAt = Date.now();
      if (grant.sessionId) this.knownSessionId = grant.sessionId;
      return grant;
    } catch (error) {
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

  private bind(socket: AgentSocket): void {
    socket.on('session:ready', (event) => {
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
      // The grant says which project the token was minted for; a socket that
      // reports another one is not the agent this token belongs to.
      const expected = this.grant?.agentId;
      if (expected && expected !== event.agentId) {
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
    });

    socket.on('chat:started', (event: ChatStartedEvent) => {
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
    });

    socket.on('chat:delta', (event: ChatDeltaEvent) => {
      const message = this.find(event.messageId);
      if (!message) return;
      message.text += event.text;
      this.emit('delta', { messageId: event.messageId, text: event.text });
      this.emit('message', { ...message, tools: [...message.tools] });
    });

    socket.on('chat:tool', (event: ChatToolEvent) => {
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
    });

    socket.on('chat:complete', (event: ChatCompleteEvent) => {
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
    });

    socket.on('chat:error', (event: ChatErrorEvent) => {
      const message = event.messageId ? this.find(event.messageId) : undefined;
      if (message) {
        message.status = 'error';
        message.error = event.message;
        this.emit('message', { ...message, tools: [...message.tools] });
      }

      const code = event.code === 'agent_error' ? 'agent_error' : event.code;
      const failure = new WebchatError(event.message, code, {
        agentId: this.agentId,
        messageId: event.messageId,
      });
      this.emit('error', failure);

      const turn = event.replyTo ? this.pending.get(event.replyTo) : undefined;
      if (turn && event.replyTo) {
        clearTimeout(turn.timer);
        this.pending.delete(event.replyTo);
        turn.reject(failure);
      }
    });

    socket.on('connect_error', (error) => {
      const failure = toWebchatError(error.message, this.agentId ?? 'unknown');
      if (isAuthFailure(error.message)) {
        // Drop the token so the next handshake asks for a fresh one.
        this.grant = undefined;
      }
      this.emit('error', failure);
    });

    socket.io.on('reconnect_attempt', () => this.setStatus('reconnecting'));

    socket.on('disconnect', (reason) => {
      this.session = undefined;
      this.setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
      this.failPending(
        new WebchatError(`Disconnected from the agent (${reason}).`, 'disconnected', {
          agentId: this.agentId,
        }),
      );
    });
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
      turn.reject(error);
    }
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
