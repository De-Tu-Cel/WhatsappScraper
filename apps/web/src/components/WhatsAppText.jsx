import { createElement } from 'react'
import { whatsappTextTokens } from '../lib/whatsappText'

function render(tokens) {
  return tokens.map((token, key) => {
    if (token.type === 'text') return token.text
    if (token.type === 'link') return <a key={key} href={token.href} target="_blank" rel="noopener noreferrer"
      style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', overflowWrap: 'anywhere' }}>{token.text}</a>
    return createElement(token.type, { key }, token.children ? render(token.children) : token.text)
  })
}

export default function WhatsAppText({ text }) {
  return render(whatsappTextTokens(text))
}
