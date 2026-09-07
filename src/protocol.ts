/**
 * Wire protocol between the webchat SDK and an ai-agent instance.
 *
 * This file is the canonical copy; ../../ai-agent/src/realtime/protocol.ts
 * mirrors it. Bump PROTOCOL_VERSION on any breaking change — the agent reports
 * its version on `session:ready`, so a mismatched client is detected instead of
 * failing later with a confusing runtime error.
 */
export const PROTOCOL_VERSION = 1;

/** server → client */
export interface SessionReadyEvent {
  protocolVersion: number;
  sessionId: string;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  /** Messages already in this session, when resuming an existing one. */
  historyLength: number;
}

export interface ChatStartedEvent {
  messageId: string;
  /** Id of the user message this reply answers. */
  replyTo: string;
}

export interface ChatDeltaEvent {
  messageId: string;
  text: string;
}

export interface ChatToolEvent {
  messageId: string;
  toolCallId: string;
  name: string;
  status: 'started' | 'completed' | 'failed';
  input?: unknown;
  /** Present when status is 'completed'. */
  output?: unknown;
  /** Present when status is 'failed'. */
  error?: string;
}

export interface ChatCompleteEvent {
  messageId: string;
  replyTo: string;
  text: string;
  finishReason: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ChatErrorEvent {
  messageId?: string;
  replyTo?: string;
  code: 'agent_error' | 'invalid_message' | 'busy' | 'cancelled';
  message: string;
}

/** client → server */
export interface ChatSendEvent {
  /** Client-generated id, echoed back as `replyTo`. */
  id: string;
  text: string;
}

export interface ChatCancelEvent {
  messageId?: string;
}

/** Visitor rating of an assistant message; `null` clears it. */
export interface ChatFeedbackEvent {
  messageId: string;
  rating: 'up' | 'down' | null;
}

export interface ServerToClientEvents {
  'session:ready': (event: SessionReadyEvent) => void;
  'chat:started': (event: ChatStartedEvent) => void;
  'chat:delta': (event: ChatDeltaEvent) => void;
  'chat:tool': (event: ChatToolEvent) => void;
  'chat:complete': (event: ChatCompleteEvent) => void;
  'chat:error': (event: ChatErrorEvent) => void;
}

export interface ClientToServerEvents {
  'chat:send': (event: ChatSendEvent) => void;
  'chat:cancel': (event: ChatCancelEvent) => void;
  'chat:reset': () => void;
  'chat:feedback': (event: ChatFeedbackEvent) => void;
}


/**
 * The same conversation over plain HTTP, for hosts that cannot hold a socket
 * open or keep a visitor's consecutive requests on one instance (Vercel and
 * the like). One request per turn: `POST /chat/stream` takes what `chat:send`
 * carries and answers with Server-Sent Events named like the socket events
 * minus their `chat:` prefix — so the SDK assembles a reply from either
 * transport with the same code.
 *
 *   POST /chat/stream  { message, id?, sessionId?, projectToken? | projectId?, userId? }
 *
 *   event: session   { sessionId, projectId, protocolVersion }   first, before the model runs
 *   event: started   ChatStartedEvent
 *   event: delta     ChatDeltaEvent
 *   event: tool      ChatToolEvent
 *   event: done      ChatCompleteEvent & { sessionId }           terminal
 *   event: error     ChatErrorEvent                              terminal
 *
 * Identity travels the same way as on the socket: a session token from
 * `POST /sessions` in `Authorization: Bearer …`, whose signed payload names
 * the session, project and visitor. Without one, the body's selectors are
 * used as given — the documented curl-from-anywhere path.
 *
 * The rest of the socket vocabulary maps onto one request each:
 *
 *   chat:cancel    → abort the in-flight request (the server aborts the turn)
 *   chat:reset     → DELETE /sessions/:id
 *   chat:feedback  → POST /chat/feedback  { messageId, rating }
 */
export type SseEventName = 'session' | 'started' | 'delta' | 'tool' | 'done' | 'error';

export interface SessionFrame {
  sessionId: string;
  projectId: string;
  protocolVersion: number;
}
