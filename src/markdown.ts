/**
 * A deliberately small Markdown renderer for chat bubbles.
 *
 * Agents answer in Markdown, so printing the raw text leaves `**bold**` and
 * `- bullets` on screen. This covers what an agent actually emits — headings,
 * lists, code, emphasis, links — and nothing else. Every node is built with
 * `createElement`/`textContent`, never `innerHTML`, so agent (or tool) output
 * can't inject markup.
 */

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/;

/** Only linkify schemes that are safe to hand to the browser. */
function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

/** Emphasis, inline code and links inside one line of text. */
function renderInline(text: string, into: Node): void {
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;
    if (match.index > 0) into.appendChild(document.createTextNode(rest.slice(0, match.index)));
    const token = match[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      into.appendChild(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      into.appendChild(strong);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = label;
        into.appendChild(link);
      } else {
        // Not a scheme we'll link to — leave the source text as the agent wrote it.
        into.appendChild(document.createTextNode(token));
      }
    } else {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      into.appendChild(em);
    }
    rest = rest.slice(match.index + token.length);
  }
  if (rest.length > 0) into.appendChild(document.createTextNode(rest));
}

/** A run of text lines: one paragraph, with single newlines kept as breaks. */
function paragraph(lines: string[], into: Node): void {
  if (lines.length === 0) return;
  const p = document.createElement('p');
  lines.forEach((line, index) => {
    if (index > 0) p.appendChild(document.createElement('br'));
    renderInline(line, p);
  });
  into.appendChild(p);
  lines.length = 0;
}

export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split('\n');
  let pending: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Fenced code block — everything up to the closing fence is literal.
    const fence = /^\s*```(\w+)?\s*$/.exec(line);
    if (fence) {
      paragraph(pending, fragment);
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i]!);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fence[1]) code.dataset.lang = fence[1];
      code.textContent = body.join('\n');
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      paragraph(pending, fragment);
      const node = document.createElement(`h${heading[1]!.length + 2}` as 'h3');
      renderInline(heading[2]!, node);
      fragment.appendChild(node);
      continue;
    }

    // A list runs until the first line that isn't an item of the same kind.
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      paragraph(pending, fragment);
      const ordered = /\d/.test(item[1]!);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      do {
        const current = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!)!;
        if (/\d/.test(current[1]!) !== ordered) break;
        const li = document.createElement('li');
        renderInline(current[2]!, li);
        list.appendChild(li);
      } while (++i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!));
      i--;
      fragment.appendChild(list);
      continue;
    }

    if (line.trim() === '') paragraph(pending, fragment);
    else pending.push(line);
  }

  paragraph(pending, fragment);
  return fragment;
}
