export type WebchatErrorCode =
  | 'token_failed'
  | 'token_expired'
  | 'auth_failed'
  | 'agent_mismatch'
  | 'protocol_mismatch'
  | 'connect_failed'
  | 'disconnected'
  | 'timeout'
  | 'busy'
  | 'cancelled'
  | 'invalid_message'
  | 'agent_error';

/** Every rejection and `error` event from the SDK is one of these. */
export class WebchatError extends Error {
  constructor(
    message: string,
    readonly code: WebchatErrorCode,
    readonly details?: { agentId?: string; messageId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'WebchatError';
  }
}

/** Connect errors socket.io reports come back as the token error codes. */
const AUTH_CODES = new Set(['missing_token', 'malformed', 'bad_signature', 'expired', 'wrong_agent']);

export function isAuthFailure(reason: string): boolean {
  return AUTH_CODES.has(reason);
}

export function toWebchatError(reason: string, agentId: string): WebchatError {
  switch (reason) {
    case 'expired':
      return new WebchatError('The session token has expired.', 'token_expired', { agentId });
    case 'missing_token':
    case 'malformed':
    case 'bad_signature':
      return new WebchatError('The agent rejected the session token.', 'auth_failed', { agentId });
    case 'wrong_agent':
      return new WebchatError(
        'The session token was issued for a different agent.',
        'agent_mismatch',
        { agentId },
      );
    default:
      return new WebchatError(reason, 'connect_failed', { agentId });
  }
}
