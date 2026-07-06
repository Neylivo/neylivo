import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { loadCustom } from './emoji'
import { guardLink } from './linkguard'
import { highlight, normLang } from './hl'
import { toastOk } from './toast'
import { Icon } from '../components/icons'
import { emojify } from './twemoji'

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

// Длинные ссылки показываем компактно: домен + начало пути (сама ссылка при этом полная).
function shortUrl(u: string): string {
  if (u.length <= 64) return u
  try { const p = new URL(u); return p.host + (p.pathname + p.search).slice(0, 28) + '\u2026' } catch { return u.slice(0, 61) + '\u2026' }
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]*\w/
const PHONE_RE = /\+\d[\d ()-]{8,16}\d/

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
    { re: URL_RE, render: m => <a key={k()} className="md-link" href={m[0]} target="_blank" rel="noopener noreferrer" onClick={e => guardLink(e, m[0])} title={m[0]}>{shortUrl(m[0])}</a> },
    { re: EMAIL_RE, render: m => <a key={k()} className="md-link" href={'mailto:' + m[0]}>{m[0]}</a> },
    { re: PHONE_RE, render: m => <a key={k()} className="md-link" href={'tel:' + m[0].replace(/[^+\d]/g, '')}>{m[0]}</a> },
    // v1.137.0: правый клик по кастом-эмодзи прямо в сообщении — меню «В избранное» (глобальный хост EmojiCtxHost в App.tsx).
    { re: /:([a-zA-Z0-9_]+):/, render: m => custom[m[1]] ? <img key={k()} className="inline-emoji" src={custom[m[1]]} alt={m[0]} title={m[0]} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('ponoi-emoji-ctx', { detail: { name: m[1], x: e.clientX, y: e.clientY } })) }} /> : m[0] },
    { re: /#([0-9a-fA-F]{6})(?![0-9a-zA-Z])/, render: m => <span key={k()} className="md-hex"><i style={{ background: '#' + m[1] }} />#{m[1]}</span> },
    { re: /@([\p{L}\p{N}_.\-]{1,32})/u, render: m => <span key={k()} className="md-mention">@{m[1]}</span> },
  ]
  const out: ReactNode[] = []
  let rest = text
  while (rest) {
    const f = firstMatch(rest, pats)
    if (!f) { out.push(...emojify(rest)); break }
    if (f.idx > 0) out.push(...emojify(rest.slice(0, f.idx)))
    out.push(f.p.render(f.m, depth))
    rest = rest.slice(f.idx + f.m[0].length)
  }
  return out
}

// Текст без код-блоков: > цитаты, #/##/### заголовки, "* "/"- " маркированные списки.
function blockText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let quote: string[] = []
  let list: string[] = []
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
  const flushList = () => {
    if (list.length) {
      out.push(<ul key={k()} className="md-list">{list.map(it => <li key={k()}>{inline(it)}</li>)}</ul>)
      list = []
    }
  }
  for (const ln of text.split('\n')) {
    const h = ln.match(/^(#{1,3})\s+(\S.*)$/)
    if (h) { flushPlain(); flushQuote(); flushList(); out.push(<div key={k()} className={'md-h' + h[1].length}>{inline(h[2])}</div>); continue }
    if (/^>\s?/.test(ln)) { flushPlain(); flushList(); quote.push(ln.replace(/^>\s?/, '')); continue }
    if (/^[*-]\s+\S/.test(ln)) { flushPlain(); flushQuote(); list.push(ln.replace(/^[*-]\s+/, '')); continue }
    flushQuote(); flushList(); plain.push(ln)
  }
  flushPlain(); flushQuote(); flushList()
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
      if (code) {
        const langName = lang ? normLang(lang[1]) && lang[1].toLowerCase() : null
        const codeText = code
        out.push(
          <div key={k()} className="md-codewrap">
            {langName && <span className="md-lang">{langName}</span>}
            <button type="button" className="md-copy" title="Копировать код"
              onClick={() => { navigator.clipboard?.writeText(codeText); toastOk('Код скопирован') }}><Icon name="copy" size={14} /></button>
            <pre className="md-codeblock">{highlight(code, lang ? lang[1] : null)}</pre>
          </div>
        )
      }
    } else if (chunks[i]) {
      out.push(...blockText(chunks[i]))
    }
  }
  return out
}

/** Есть ли в тексте упоминание конкретного пользователя (или @everyone). */
export function mentionsUser(text: string, name: string): boolean {
  if (!text || !name) return false
  if (/@everyone(?![\p{L}\p{N}_])/u.test(text)) return true
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try { return new RegExp('@' + esc + '(?![\\p{L}\\p{N}_])', 'iu').test(text) } catch { return false }
}
