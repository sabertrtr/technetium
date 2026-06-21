import DOMPurify from 'dompurify'
import type { MatrixEvent } from 'matrix-js-sdk'

// Strict allowlist matching the Matrix spec's permitted HTML subset for
// m.room.message formatted_body (org.matrix.custom.html). Anything not listed
// — scripts, event handlers, iframes, styles, forms, etc. — is stripped.
const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike',
  'a', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'p', 'br', 'hr', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'sub', 'sup', 'caption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

// Only safe attributes. Notably NO style/on*; href is allowed but DOMPurify
// strips javascript:/data: URI schemes by default.
const ALLOWED_ATTR = ['href', 'title', 'alt', 'colspan', 'rowspan', 'start']

export interface RenderedBody {
  // When html is set, render via dangerouslySetInnerHTML (already sanitized).
  // Otherwise render `text` as a plain string.
  html?: string
  text?: string
}

// Produce a safe renderable body for a message event. Prefers sanitized HTML
// from formatted_body; falls back to the plaintext body.
export function renderMessageBody(event: MatrixEvent): RenderedBody {
  const content = event.getContent()
  const body = (content.body as string) ?? ''

  const hasHtml =
    content.format === 'org.matrix.custom.html' &&
    typeof content.formatted_body === 'string'

  if (!hasHtml) return { text: body }

  const clean = DOMPurify.sanitize(content.formatted_body as string, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Force any surviving links to be safe: no javascript:, and target handling
    // is added at render time. DOMPurify already drops dangerous URI schemes.
    ALLOW_DATA_ATTR: false,
  })

  return { html: clean }
}
