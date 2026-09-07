import type { WebchatError } from './errors.js';
import type {
  ChatCancelEvent,
  ChatFeedbackEvent,
  ChatSendEvent,
  ServerToClientEvents,
  SessionReadyEvent,
} from './protocol.js';
import type { TokenGrant, WebchatStatus } from './types.js';

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEvent<K extends ServerEventName> = Parameters<ServerToClientEvents[K]>[0];

/**
 * What a transport reports back to the client. The client owns the transcript,
 * the pending turns and the token; a transport only moves protocol events.
 */
export interface TransportHandlers {
  /** A protocol event from the agent — a socket.io event or an SSE frame, the client cannot tell. */
  onEvent<K extends ServerEventName>(name: K, event: ServerEvent<K>): void;
  onStatus(status: WebchatStatus): void;
  /** The conversation dropped: every turn in flight is lost. */
  onDisconnected(reason: string): void;
  /**
   * A failure that is not a turn's own (`chat:error` covers those). With
   * `replyTo`, the turn that was being sent is rejected with it as well.
   */
  onError(error: WebchatError, replyTo?: string): void;
}

/** What the client lends a transport. */
export interface TransportContext {
  url: string;
  /**
   * A grant that is not about to expire; re-minted when needed. `fresh` asks
   * for a new mint even so — for the session given, or the one the client
   * knows — falling back to the cached grant if minting fails.
   */
  token(options?: { fresh?: boolean; sessionId?: string }): Promise<TokenGrant>;
  /** The agent refused the token: forget it so the next `token()` mints afresh. */
  dropToken(): void;
  /** The conversation and project the client knows of, for correlation and fallbacks. */
  sessionId(): string | undefined;
  agentId(): string | undefined;
  fetch: typeof globalThis.fetch;
  headers?: Record<string, string>;
  handlers: TransportHandlers;
}

/**
 * One way of carrying the protocol in ./protocol.ts. Two ship with the SDK:
 * socket.io (./transport-socket.ts), and plain HTTP requests answered with
 * Server-Sent Events (./transport-http.ts).
 */
export interface Transport {
  readonly connected: boolean;
  /** Opens the conversation; resolves with the agent's handshake. */
  connect(): Promise<SessionReadyEvent>;
  send(event: ChatSendEvent): void;
  cancel(event: ChatCancelEvent): void;
  reset(): void;
  feedback(event: ChatFeedbackEvent): void;
  disconnect(): void;
}
