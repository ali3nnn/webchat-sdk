/**
 * What a visitor reads when the site owner's plan has run out for the month.
 * Unlike other failures this is not a hiccup — trying again in a moment will
 * not help — so it gets its own line instead of one of the project's error
 * messages. The visitor is not told about plans; that is the owner's business
 * (the Studio tells them).
 *
 * In the project's webchat language where there is a line for it, English
 * otherwise.
 */
export type LimitCode = 'session_quota_exceeded' | 'quota_exceeded';

const LIMIT_MESSAGES: Record<string, Record<LimitCode, string>> = {
  en: {
    session_quota_exceeded: "This assistant isn't taking new conversations right now. Please try again later.",
    quota_exceeded: "This assistant can't answer more questions right now. Please try again later.",
  },
  de: {
    session_quota_exceeded: 'Dieser Assistent nimmt gerade keine neuen Unterhaltungen an. Bitte versuchen Sie es später noch einmal.',
    quota_exceeded: 'Dieser Assistent kann gerade keine weiteren Fragen beantworten. Bitte versuchen Sie es später noch einmal.',
  },
  ro: {
    session_quota_exceeded: 'Acest asistent nu poate începe conversații noi momentan. Vă rugăm să încercați mai târziu.',
    quota_exceeded: 'Acest asistent nu mai poate răspunde la întrebări momentan. Vă rugăm să încercați mai târziu.',
  },
  fr: {
    session_quota_exceeded: "Cet assistant n'accepte pas de nouvelles conversations pour le moment. Veuillez réessayer plus tard.",
    quota_exceeded: 'Cet assistant ne peut plus répondre aux questions pour le moment. Veuillez réessayer plus tard.',
  },
  es: {
    session_quota_exceeded: 'Este asistente no acepta nuevas conversaciones en este momento. Por favor, inténtelo más tarde.',
    quota_exceeded: 'Este asistente no puede responder más preguntas en este momento. Por favor, inténtelo más tarde.',
  },
  it: {
    session_quota_exceeded: 'Questo assistente al momento non accetta nuove conversazioni. Riprova più tardi.',
    quota_exceeded: 'Questo assistente al momento non può rispondere ad altre domande. Riprova più tardi.',
  },
};

export function isLimitCode(code: unknown): code is LimitCode {
  return code === 'session_quota_exceeded' || code === 'quota_exceeded';
}

/** The line for `code` in `language` (ISO 639-1), falling back to English. */
export function limitMessage(code: LimitCode, language?: string): string {
  const lines = LIMIT_MESSAGES[(language ?? '').toLowerCase().slice(0, 2)] ?? LIMIT_MESSAGES.en!;
  return lines[code];
}
