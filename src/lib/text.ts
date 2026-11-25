/** Email bodies arrive as HTML with the whole earlier thread quoted underneath. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<blockquote[\s\S]*$/i, '') // quoted history is always last
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
}

/** Cuts the quoted earlier messages ("On … wrote:", "> …", Outlook headers) off a reply. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const cut = lines.findIndex((line, i) => {
    const l = line.trim()
    if (/^>/.test(l)) return true
    if (/^-{2,}\s*original message\s*-{2,}/i.test(l)) return true
    if (/^from:\s.+/i.test(l) && /^(sent|date|to):/i.test(lines[i + 1]?.trim() ?? '')) return true
    // "On Mon, Aug 31, 2026 at 12:14 PM Name <x@y> wrote:" — sometimes wrapped over two lines.
    return /^on\s.+/i.test(l) && /wrote:\s*$/i.test(`${l} ${lines[i + 1]?.trim() ?? ''}`)
  })
  const kept = cut === -1 ? lines : lines.slice(0, cut)
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function cleanBody(raw: string | undefined, isHtml: boolean): string {
  if (!raw) return ''
  return stripQuoted(isHtml ? htmlToText(raw) : raw)
}
