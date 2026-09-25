/**
 * The "Powered by …" line under the composer.
 *
 * Its text is HTML written in the Chat Studio, and it is rendered on the
 * customer's page — so it is never handed to `innerHTML`. It is parsed into an
 * inert document (DOMParser runs no scripts and loads nothing), then rebuilt
 * node by node from a short allowlist: links and emphasis. Every other element
 * is reduced to its text, and every attribute but a link's checked `href` is
 * dropped, so no handler, style or script can come through.
 */

const EMPHASIS = new Set(['B', 'STRONG', 'I', 'EM']);

/**
 * A link target safe to put on someone else's page. A bare domain
 * (`brainigy.eu`) gets `https://`: left as written, the browser would resolve
 * it against the host page (`customer.com/brainigy.eu`).
 */
export function watermarkHref(raw: string): string | null {
  const value = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value)) return `https://${value}`;
  return null;
}

function rebuild(source: Node, into: Node): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(document.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    if (el.tagName === 'BR') {
      into.appendChild(document.createElement('br'));
    } else if (el.tagName === 'A') {
      const href = watermarkHref(el.getAttribute('href') ?? '');
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        rebuild(el, link);
        into.appendChild(link);
      } else {
        rebuild(el, into);
      }
    } else if (EMPHASIS.has(el.tagName)) {
      const kept = document.createElement(el.tagName.toLowerCase());
      rebuild(el, kept);
      into.appendChild(kept);
    } else if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
      // Anything else keeps its text and loses the element.
      rebuild(el, into);
    }
  }
}

export function renderWatermark(html: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  rebuild(parsed.body, fragment);
  return fragment;
}
