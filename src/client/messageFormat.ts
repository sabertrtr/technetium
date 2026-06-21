import { parseInline } from 'marked'
import DOMPurify from 'dompurify'

// Same strict allowlist as the receive-side sanitizer (messageBody.ts). marked
// passes raw HTML through by default, so we MUST sanitize its output before
// sending — a user typing literal <script> in the composer would otherwise put
// it on the wire.
const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike',
  'a', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'p', 'br', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]
const ALLOWED_ATTR = ['href', 'title']

export interface FormattedMessage {
  // The plaintext body (always sent as `body`, the fallback for non-HTML clients).
  plain: string
  // The sanitized HTML body — set ONLY when markdown actually produced formatting.
  // When undefined, send as plain text (no pointless formatted_body).
  html?: string
}

// Convert composer input (markdown) to a Matrix message. Decides whether to send
// formatted HTML or plain text by checking if conversion actually changed anything.
export function formatMessage(input: string): FormattedMessage {
  const plain = input.trim()
  if (!plain) return { plain }

  // Inline parse: no wrapping <p>, suitable for a single chat line. Newlines in
  // the source become <br> via breaks:true.
  const raw = parseInline(plain, { breaks: true }) as string
  const html = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })

  // If sanitized HTML differs from the original text, formatting happened ->
  // send HTML. If it's identical (plus any &-escaping), it's plain -> send plain.
  // Compare against an HTML-escaped version of the plain text so that escaping
  // alone (e.g. & -> &amp;) doesn't count as "formatting".
  const escapedPlain = escapeHtml(plain).replace(/\n/g, '<br>')
  if (html === escapedPlain) return { plain }

  return { plain, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
