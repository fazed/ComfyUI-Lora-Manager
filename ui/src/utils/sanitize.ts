/**
 * Allow-list HTML sanitizer for Civitai model descriptions.
 *
 * Keeps basic formatting tags, drops every attribute except safe http(s)
 * links, and removes inline styles (Civitai descriptions carry hard-coded
 * colors that would clash with the active theme).
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'CODE', 'PRE', 'BLOCKQUOTE', 'SPAN', 'DIV', 'HR',
])
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH'])

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const element = node as Element
  const tag = element.tagName.toUpperCase()
  if (DROP_WITH_CONTENT.has(tag)) return null

  const children = Array.from(element.childNodes)
    .map((child) => cleanNode(child, doc))
    .filter((child): child is Node => child !== null)

  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment()
    children.forEach((child) => fragment.appendChild(child))
    return fragment
  }

  const out = doc.createElement(tag.toLowerCase())
  if (tag === 'A') {
    const href = element.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href.trim())) {
      out.setAttribute('href', href.trim())
      out.setAttribute('target', '_blank')
      out.setAttribute('rel', 'noopener noreferrer')
    }
  }
  children.forEach((child) => out.appendChild(child))
  return out
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return ''
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const container = document.createElement('div')
  for (const child of Array.from(parsed.body.childNodes)) {
    const cleaned = cleanNode(child, document)
    if (cleaned) container.appendChild(cleaned)
  }
  return container.innerHTML
}
