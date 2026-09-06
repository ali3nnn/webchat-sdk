import type { SessionReadyEvent } from './protocol.js';
import type { WebchatError } from './errors.js';

/**
 * How a project's webchat presents itself — configured in the Chat Studio and
 * served by the agent at GET /widget/config. Mirrors the server's
 * `WebchatSettings`; every field can be overridden per embed.
 */
export interface WebchatSettings {
  agentName: string;
  /** Image URL or data URL; empty = initials badge. The fallback for the two below. */
  avatarUrl: string;
  /** Image on the floating launcher; empty = `avatarUrl`, or the built-in chat bubble. */
  launcherIconUrl: string;
  /** Image next to a block of replies; empty = `avatarUrl`. */
  messageAvatarUrl: string;
  showAvatarInHeader: boolean;
  showAvatarOnMessages: boolean;
  /** Show tool activity ("knowledge_retrieval · completed") under replies. */
  showTools: boolean;
  bubbleStyle: 'round' | 'wide';
  /** Pop-up next to the launcher when the chat was not started after `delayMs`. */
  teaser: { enabled: boolean; text: string; delayMs: number };
  colors: { launcher: string; userBubble: string; assistantBubble: string; background: string; header: string };
  disclaimer: { enabled: boolean; text: string };
  inputPlaceholder: string;
  /** Label on the send button, or its tooltip/screen-reader name when it shows the icon. */
  sendButtonText: string;
  /** Render the send button as its text, or as a paper-plane icon. */
  sendButtonStyle: 'text' | 'icon';
  /** Rendered locally before the first message; never sent to the agent. */
  greetings: string[];
  timestamps: 'hidden' | '12h' | '24h';
  /** Gate the composer behind a notice until accepted (remembered in localStorage). */
  privacy: { enabled: boolean; title: string; content: string; acceptLabel: string };
  /** Keep the transcript in localStorage and resume the session across pages. */
  persistConversation: boolean;
  showNewChatButton: boolean;
  feedbackEnabled: boolean;
  position: 'bottom-right' | 'bottom-left';
}

export type WebchatSettingsOverrides = {
  [K in keyof WebchatSettings]?: WebchatSettings[K] extends object
    ? WebchatSettings[K] extends unknown[]
      ? WebchatSettings[K]
      : Partial<WebchatSettings[K]>
    : WebchatSettings[K];
};

/** What the agent's POST /sessions endpoint returns. */
export interface TokenGrant {
  token: string;
  sessionId?: string;
  expiresAt?: string;
  /** The project the server minted this token for. */
  agentId?: string;
  agentName?: string;
  webchat?: WebchatSettings;
}

export type TokenProvider = (context: {
  /** Project token this session is for, as configured on the client. */
  projectToken?: string;
  /** Base URL of the agent. */
  url: string;
  /** Session to resume, when the caller asked for one. */
  sessionId?: string;
  /** Stable visitor id, so the agent can count returning users. */
  userId?: string;
}) => TokenGrant | Promise<TokenGrant>;

export type WebchatStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface WebchatToolActivity {
  toolCallId: string;
  name: string;
  status: 'started' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface WebchatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  /** Tool activity the agent reported while producing this message. */
  tools: WebchatToolActivity[];
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** The visitor's rating of an assistant message, when feedback is enabled. */
  feedback?: 'up' | 'down' | null;
}

export interface WebchatClientOptions {
  /** Base URL of the ai-agent instance, e.g. https://support-agent.internal. */
  url: string;
  /**
   * The project's public embed token, copied from the Chat Studio. It selects
   * which project on the server answers; omit it for the server's default
   * project. Safe to put in a page — it identifies a project, it does not
   * authorise anything on its own.
   */
  projectToken?: string;
  /** A session token you already have (minted by your backend). */
  token?: string;
  /**
   * How to obtain a token. Defaults to POSTing to `${url}/sessions`, which is
   * what a public widget wants; pass your own to mint tokens on your backend.
   */
  tokenProvider?: TokenProvider;
  /** Resume a specific conversation instead of starting a new one. */
  sessionId?: string;
  /** Stable visitor id (the widget keeps one in localStorage). */
  userId?: string;
  /** socket.io path the agent serves. Defaults to `/webchat`. */
  socketPath?: string;
  /** Connect as soon as the client is created. Defaults to false. */
  autoConnect?: boolean;
  /** socket.io reconnection. Defaults to true. */
  reconnection?: boolean;
  reconnectionAttempts?: number;
  /** How long `connect()` and `send()` wait before giving up. Defaults to 30s / 120s. */
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
  /** Extra headers for the default token endpoint (e.g. `x-webchat-key`). */
  headers?: Record<string, string>;
  /** Injectable fetch, for Node runtimes or tests. */
  fetch?: typeof globalThis.fetch;
  /** socket.io transports. Defaults to websocket first, polling as fallback. */
  transports?: ('websocket' | 'polling')[];
  /**
   * Put the session and project ids in the socket.io handshake URL as
   * `sessionId` and `agentId`, so a connection can be found again in proxy/CDN
   * access logs and in a visitor's HAR file. Correlation only — the agent reads
   * identity from the signed token and never from the query. Defaults to true;
   * set false to keep the handshake URL free of ids.
   */
  correlationIds?: boolean;
}

export interface WebchatEvents {
  /** Handshake completed; the agent identified itself. */
  ready: SessionReadyEvent;
  /** Connection lifecycle. */
  status: WebchatStatus;
  /** A message was added or changed — convenient for re-rendering a transcript. */
  message: WebchatMessage;
  /** Incremental assistant text. */
  delta: { messageId: string; text: string };
  /** Tool call started / completed / failed. */
  tool: WebchatToolActivity & { messageId: string };
  /** An assistant turn finished. */
  complete: WebchatMessage;
  /** Anything that went wrong, connection-level or turn-level. */
  error: WebchatError;
}
