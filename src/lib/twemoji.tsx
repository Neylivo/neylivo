// Красивые эмодзи как в Discord: все юникод-эмодзи рендерятся картинками Twemoji
// (Discord использует именно этот набор). Без npm-зависимости — SVG с CDN,
// с фолбэком на системный эмодзи, если картинка не загрузилась.
import { useState } from 'react'
import type { ReactNode } from 'react'

const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/'

// Последовательности эмодзи: флаги, кейкапы (1️⃣), пиктограммы с тонами кожи,
// VS16 и ZWJ-склейками (👨‍👩‍👧).
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])*)*/gu

// Одиночные ©®™ без VS16 — обычный текст, не эмодзи.
const TEXTY = /^[\u00A9\u00AE\u2122]$/

/** URL картинки Twemoji для эмодзи-последовательности (правило имён как в twemoji). */
export function emojiUrl(emoji: string): string {
  const cps: string[] = []
  for (const ch of emoji) cps.push(ch.codePointAt(0)!.toString(16))
  const named = emoji.includes('\u200D') ? cps : cps.filter(c => c !== 'fe0f')
  return CDN + named.join('-') + '.svg'
}

function TwEmoji({ ch }: { ch: string }) {
  const [err, setErr] = useState(false)
  if (err) return <>{ch}</>   // нет такой картинки — показываем системный эмодзи
  return <img className="twemoji" draggable={false} src={emojiUrl(ch)} alt={ch} loading="lazy" onError={() => setErr(true)} />
}

let seq = 0
const k = () => 'tw' + (seq = (seq + 1) % 1e9)

/** Заменяет юникод-эмодзи в тексте на картинки Twemoji. */
export function emojify(text: string): ReactNode[] {
  if (!text) return []
  EMOJI_RE.lastIndex = 0
  if (!EMOJI_RE.test(text)) return [text]
  const out: ReactNode[] = []
  let last = 0
  EMOJI_RE.lastIndex = 0
  for (const m of text.matchAll(EMOJI_RE)) {
    const i = m.index!
    if (TEXTY.test(m[0])) continue
    if (i > last) out.push(text.slice(last, i))
    out.push(<TwEmoji key={k()} ch={m[0]} />)
    last = i + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Инлайн-обёртка: <Em>{'🔥'}</Em> → красивый Twemoji. */
export function Em({ children }: { children: string }) {
  return <>{emojify(children)}</>
}
