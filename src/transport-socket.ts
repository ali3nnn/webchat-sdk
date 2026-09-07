import { io, type Socket } from 'socket.io-client';
import { WebchatError, isAuthFailure, toWebchatError } from './errors.js';
import type {
  ChatCancelEvent,
  ChatFeedbackEvent,
  ChatSendEvent,
  ClientToServerEvents,
  ServerToClientEvents,
  SessionReadyEvent,
} from './protocol.js';
import type { Transport, TransportContext } from './transport.js';
import type { TokenGrant, WebchatClientOptions } from './types.js';

type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * The protocol over socket.io: one long-lived connection per conversation,
 * the token presented in the handshake, reconnection handled by socket.io.
 */
export class SocketTransport implements Transport {
  private socket: AgentSocket | undefined;

  constructor(
    private readonly options: WebchatClientOptions,
    private readonly ctx: TransportContext,
  ) {}

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  async connect(): Promise<SessionReadyEvent> {
    const { ctx } = this;
    // Fail fast with a clear error if the token cannot be obtained at all.
    const grant = await ctx.token();

    const socket: AgentSocket = io(ctx.url, {
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
        ctx.token().then(
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
          new WebchatError(`Timed out connecting to ${ctx.url}.`, 'timeout', { agentId: ctx.agentId() }),
        );
      }, this.options.connectTimeoutMs ?? 30_000);

      const onReady = (event: SessionReadyEvent) => {
        cleanup();
        resolve(event);
      };
      const onError = (error: Error) => {
        // An auth failure never fixes itself by retrying with the same token.
        if (isAuthFailure(error.message)) {
          cleanup();
          socket.close();
          reject(toWebchatError(error.message, ctx.agentId() ?? 'unknown'));
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

  send(event: ChatSendEvent): void {
    this.socket?.emit('chat:send', event);
  }

  cancel(event: ChatCancelEvent): void {
    this.socket?.emit('chat:cancel', event);
  }

  reset(): void {
    this.socket?.emit('chat:reset');
  }

  feedback(event: ChatFeedbackEvent): void {
    this.socket?.emit('chat:feedback', event);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = undefined;
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
    const sessionId = grant.sessionId ?? this.ctx.sessionId();
    const agentId = grant.agentId ?? this.ctx.agentId();
    if (sessionId) query.sessionId = sessionId;
    if (agentId) query.agentId = agentId;
    return Object.keys(query).length > 0 ? query : undefined;
  }

  private bind(socket: AgentSocket): void {
    const { handlers } = this.ctx;
    socket.on('session:ready', (event) => handlers.onEvent('session:ready', event));
    socket.on('chat:started', (event) => handlers.onEvent('chat:started', event));
    socket.on('chat:delta', (event) => handlers.onEvent('chat:delta', event));
    socket.on('chat:tool', (event) => handlers.onEvent('chat:tool', event));
    socket.on('chat:complete', (event) => handlers.onEvent('chat:complete', event));
    socket.on('chat:error', (event) => handlers.onEvent('chat:error', event));

    socket.on('connect_error', (error) => {
      // Drop the token so the next handshake asks for a fresh one.
      if (isAuthFailure(error.message)) this.ctx.dropToken();
      handlers.onError(toWebchatError(error.message, this.ctx.agentId() ?? 'unknown'));
    });
    socket.io.on('reconnect_attempt', () => handlers.onStatus('reconnecting'));
    socket.on('disconnect', (reason) => handlers.onDisconnected(reason));
  }
}
