/**
 * What a visitor reads when something failed: one of the project's own error
 * messages, never the error itself — that is for the site's developers, so it
 * goes to the console.
 *
 * The lines come from the project's webchat settings (`errorMessages`: three
 * tones of up to three lines, written and edited in the Studio). The widget
 * remembers the ones it last received, so it still has the right words on the
 * day the agent cannot be reached. These English lines are only for a browser
 * that has never reached the agent at all — which also means it was never told
 * the project's language.
 */
export const FALLBACK_ERROR_MESSAGES: readonly string[] = [
  'Sorry, the AI agent is taking a quick coffee break ☕ Please try again in a moment.',
  'Oops, our AI agent tripped over a cable. Please try again in a moment.',
  'Our AI agent is thinking a little too hard right now. Please try again shortly.',
];

export type ErrorTone = 'informal' | 'neutral' | 'formal';

/** The project's error messages, as the agent serves them in the webchat settings. */
export interface WebchatErrorMessages {
  language: string;
  tone: ErrorTone;
  informal: string[];
  neutral: string[];
  formal: string[];
}

/** The lines of the chosen tone, blanks dropped; empty when the settings carry none. */
export function toneLines(messages: WebchatErrorMessages | undefined): string[] {
  const lines = messages?.[messages.tone];
  return Array.isArray(lines) ? lines.map((line) => String(line).trim()).filter(Boolean) : [];
}

/**
 * One of `lines`, at random — or, given a `seed` (a message id), always the
 * same one for it, so a failed message keeps its line across re-renders.
 */
export function pickLine(lines: readonly string[], seed?: string): string {
  const pool = lines.length > 0 ? lines : FALLBACK_ERROR_MESSAGES;
  let index = Math.floor(Math.random() * pool.length);
  if (seed !== undefined) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    index = Math.abs(hash) % pool.length;
  }
  return pool[index]!;
}
