// Cómo leer un mensaje de WhatsApp para mostrarlo: contactos (vCard), documentos, opciones de
// botones/lista y marcadores de multimedia. Lo comparten Conversaciones y el screenshot del
// reporte (analytics.jsx) — antes el reporte imprimía el texto crudo ("[Opciones: …]",
// "BEGIN:VCARD…") mientras Conversaciones ya lo mostraba adaptado.

export function parseVCards(text) {
  const cards = []
  const blocks = (text || '').match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || []
  for (const block of blocks) {
    const get = (key) => {
      const re = new RegExp(`^${key}[^:]*:(.+)`, 'im')
      const m = block.match(re)
      return m ? m[1].trim() : ''
    }
    const fn = get('FN') || get('N').split(';').filter(Boolean).reverse().join(' ')
    const tel = get('TEL')
    const biz = get('X-WA-BIZ-NAME')
    cards.push({ fn, tel, biz })
  }
  return cards
}

// The MIME subtype alone is unreadable for Office formats (e.g.
// "vnd.openxmlformats-officedocument.spreadsheetml.sheet") — map the ones
// this app's own upload allow-list (_ALLOWED_MIME in routes.py) actually
// accepts to their real file extensions (+ the accent each gets in the
// document chip, matching the color each app already uses for its own
// files elsewhere — red PDF, blue Word, green Excel, orange PowerPoint);
// anything else falls back to the raw subtype, uppercased, in the app's
// neutral accent.
const DOC_TYPES = {
  'pdf':                                                                       { label: 'PDF',  color: '#f87171' },
  'msword':                                                                    { label: 'DOC',  color: '#60a5fa' },
  'vnd.openxmlformats-officedocument.wordprocessingml.document':              { label: 'DOCX', color: '#60a5fa' },
  'vnd.ms-excel':                                                              { label: 'XLS',  color: '#4ade80' },
  'vnd.openxmlformats-officedocument.spreadsheetml.sheet':                    { label: 'XLSX', color: '#4ade80' },
  'vnd.ms-powerpoint':                                                        { label: 'PPT',  color: '#fb923c' },
  'vnd.openxmlformats-officedocument.presentationml.presentation':           { label: 'PPTX', color: '#fb923c' },
}

export function documentType(mimeType, fallbackLabel) {
  const subtype = (mimeType || '').split('/')[1] || ''
  return DOC_TYPES[subtype] || { label: subtype ? subtype.toUpperCase() : fallbackLabel, color: null }
}

// "texto\n[Opciones: A | B | C]" o "[Lista: …]" — como guarda el backend los mensajes con botones
// o lista (_extract_body_and_interactive en routes.py). Sirve para los mensajes que no traen el
// campo `interactive` (los más viejos) → { type, text, options } o null.
export function splitInlineOptions(body) {
  const m = (body || '').match(/\n?\[(Opciones|Lista):\s*([^\]]*)\]\s*$/)
  if (!m) return null
  const options = m[2].split('|').map(s => s.trim()).filter(Boolean)
  if (!options.length) return null
  return { type: m[1] === 'Lista' ? 'list' : 'buttons', text: body.slice(0, m.index).trim(), options }
}

// Marcadores que guarda el backend en vez de texto para multimedia sin descargar.
export const MEDIA_PLACEHOLDERS = {
  '[sticker]':  { emoji: '🙂', label: { en: 'Sticker',   es: 'Sticker' } },
  '[audio]':    { emoji: '🎤', label: { en: 'Audio',     es: 'Audio' } },
  '[imagen]':   { emoji: '🖼️', label: { en: 'Image',     es: 'Imagen' } },
  '[image]':    { emoji: '🖼️', label: { en: 'Image',     es: 'Imagen' } },
  '[video]':    { emoji: '🎥', label: { en: 'Video',     es: 'Video' } },
  '[location]': { emoji: '📍', label: { en: 'Location',  es: 'Ubicación' } },
  '[contact]':  { emoji: '👤', label: { en: 'Contact',   es: 'Contacto' } },
  '[document]': { emoji: '📄', label: { en: 'Document',  es: 'Documento' } },
  '[media]':    { emoji: '📎', label: { en: 'Media',     es: 'Multimedia' } },
  '[template]': { emoji: '🧾', label: { en: 'Template',  es: 'Plantilla' } },
}

// Texto que acompaña a una foto o documento. Si se mandó sin texto, el backend guarda la URL del
// archivo como cuerpo del mensaje (/send-message en routes.py): eso no es un pie de foto y se
// mostraba como un link largo debajo del documento.
export function mediaCaption(body, mediaUrl) {
  const t = (body || '').trim()
  if (!t || /^\[.*\]$/.test(t) || t.includes('BEGIN:VCARD')) return ''
  if (t === (mediaUrl || '').trim() || /^https?:\/\/\S+\/api\/files\/\S+$/i.test(t)) return ''
  return body
}
