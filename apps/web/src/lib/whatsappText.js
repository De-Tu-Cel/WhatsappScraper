// Gas Imperial (2026-10-15): interpretar formato sin alterar el texto guardado
// ni inventar direcciones para palabras como *link*. Nunca se interpreta HTML.
export function whatsappTextTokens(value, depth = 0) {
  const text = String(value || '')
  const tokens = []
  let plain = ''
  const flush = () => { if (plain) { tokens.push({ type: 'text', text: plain }); plain = '' } }
  const formats = [['```', 'code'], ['**', 'strong'], ['*', 'strong'], ['_', 'em'], ['~', 's'], ['`', 'code']]
  for (let i = 0; i < text.length;) {
    const boundary = i === 0 || !/[\p{L}\p{N}_]/u.test(text[i - 1])
    const url = boundary && text.slice(i).match(/^(?:https?:\/\/|www\.)[^\s<>"`]+/i)
    if (url) {
      let label = url[0].replace(/[.,!?;:]+$/, '')
      while (label.endsWith(')') && (label.match(/\)/g) || []).length > (label.match(/\(/g) || []).length) label = label.slice(0, -1)
      const href = /^www\./i.test(label) ? `https://${label}` : label
      try {
        const parsed = new URL(href)
        if (parsed.hostname && ['http:', 'https:'].includes(parsed.protocol)) {
          flush(); tokens.push({ type: 'link', text: label, href }); i += label.length; continue
        }
      } catch { /* Mantener como texto las direcciones incompletas. */ }
    }
    let formatted = false
    if (boundary && depth < 8) for (const [marker, type] of formats) {
      if (!text.startsWith(marker, i)) continue
      const start = i + marker.length
      const end = text.indexOf(marker, start)
      const inner = end >= 0 ? text.slice(start, end) : ''
      if (!inner || /^\s|\s$/.test(inner) || (type !== 'code' && inner.includes('\n'))) continue
      if (end + marker.length < text.length && /[\p{L}\p{N}_]/u.test(text[end + marker.length])) continue
      flush()
      tokens.push(type === 'code' ? { type, text: inner } : { type, children: whatsappTextTokens(inner, depth + 1) })
      i = end + marker.length; formatted = true; break
    }
    if (!formatted) { plain += text[i]; i++ }
  }
  flush()
  return tokens
}
