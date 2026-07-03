import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { loadCustom } from './emoji'

// Мини-маркдаун как в Discord: **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~,
// `код`, ```блок кода```, > цитата, ||спойлер|| (клик — раскрыть), кликабельные ссылки
// и :кастом-эмодзи:. Никакого HTML — только безопасный рендер в React-узлы.

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={'md-spoiler' + (open ? ' open' : '')}
      title={open ? undefined : 'Спойлер — нажми, чтобы раскрыть'}
      onClick={() => setOpen(true)}>{children}</span>
  )
}

let seq = 0
const k = () => 'md' + (seq = (seq + 1) % 1e9)

const URL_RE = /https?:\/\/[^\s<>]+[^\s<>.,)!?;:'"]/

interface Pat { re: RegExp; render: (m: RegExpMatchArray, depth: number) => ReactNode }

function firstMatch(text: string, pats: Pat[]) {
  let best: { idx: number; m: RegExpMatchArray; p: Pat } | null = null
  for (const p of pats) {
    const m = text.match(p.re)
    if (m && m.index !== undefined && (!best || m.index < best.idx)) best = { idx: m.index, m, p }
  }
  return best
}

function inline(text: string, depth = 0): ReactNode[] {
  if (!text) return []
  if (depth > 6) return [text]
  const custom = loadCustom()
  const pats: Pat[] = [
    { re: /`([^`\n]+)`/, render: m => <code key={k()} className="md-code">{m[1]}</code> },
    { re: /\|\|([\s\S]+?)\|\|/, render: (m, d) => <Spoiler key={k()}>{inline(m[1], d + 1)}</Spoiler> },
    { re: /\*\*([\s\S]+?)\*\*/, render: (m, d) => <b key={k()}>{inline(m[1], d + 1)}</b> },
    { re: /__([\s\S]+?)__/, render: (m, d) => <u key={k()}>{inline(m[1], d + 1)}</u> },
    { re: /~~([\s\S]+?)~~/, render: (m, d) => <s key={k()}>{inline(m[1], d + 1)}</s> },
    { re: /\*([^*\n]+)\*/, render: (m, d) => <i key={k()}>{inline(m[1], d + 1)}</i> },
    { re: /(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/u, render: (m, d) => <i key={k()}>{inline(m[1], d + 1)}</i> },
    { re: URL_RE, render: m => <a key={k()} className="md-link" href={m[0]} target="_blank" rel="noopener noreferrer">{m[0]}</a> },
    { re: /:([a-zA-Z0-9_]+):/, render: m => custom[m[1]] ? <img key={k()} className="inline-emoji" src={custom[m[1]]} alt={m[0]} /> : m[0] },
  ]
  const out: ReactNode[] = []
  let rest = text
  while (rest) {
    const f = firstMatch(rest, pats)
    if (!f) { out.push(rest); break }
    if (f.idx > 0) out.push(rest.slice(0, f.idx))
    out.push(f.p.render(f.m, depth))
    rest = rest.slice(f.idx + f.m[0].length)
  }
  return out
}

// Текст без код-блоков: строки, начинающиеся с "> ", группируются в цитату.
function blockText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let quote: string[] = []
  let plain: string[] = []
  const flushPlain = () => {
    if (plain.length) {
      const joined = plain.join('\n')
      if (joined.trim()) out.push(<Fragment key={k()}>{inline(joined)}</Fragment>)
      plain = []
    }
  }
  const flushQuote = () => {
    if (quote.length) {
      out.push(<div key={k()} className="md-quote">{inline(quote.join('\n'))}</div>)
      quote = []
    }
  }
  for (const ln of text.split('\n')) {
    if (/^>\s?/.test(ln)) { flushPlain(); quote.push(ln.replace(/^>\s?/, '')) }
    else { flushQuote(); plain.push(ln) }
  }
  flushPlain(); flushQuote()
  return out
}

/** Рендер текста сообщения в React-узлы (маркдаун + кастом-эмодзи). */
export function renderMd(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const chunks = String(text ?? '').split('```')
  for (let i = 0; i < chunks.length; i++) {
    if (i % 2 === 1) {
      let code = chunks[i]
      const lang = code.match(/^([a-zA-Z0-9+#-]{1,12})\n/)
      if (lang) code = code.slice(lang[0].length)
      code = code.replace(/^\n+|\n+$/g, '')
      if (code) out.push(<pre key={k()} className="md-codeblock">{code}</pre>)
    } else if (chunks[i]) {
      out.push(...blockText(chunks[i]))
    }
  }
  return out
}
