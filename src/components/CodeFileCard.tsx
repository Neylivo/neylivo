import { useEffect, useState } from 'react'
import { highlight } from '../lib/hl'
import { copyMediaLink, saveMedia } from '../lib/copyMedia'
import { toastOk, toastErr } from '../lib/toast'
import { Icon } from './icons'

// v1.83.0: текстовые/кодовые вложения (.txt, .js, .html, .py, …) рендерятся
// 1-в-1 как в Discord: карточка с превью кода (подсветка синтаксиса из
// src/lib/hl.tsx), под ним строка файла — шеврон (свернуть/развернуть превью),
// имя, размер и кнопки: «<>» (показать весь код), развернуть на весь экран, «…».

// Расширение файла → язык для подсветки (нормализацию делает normLang в hl.tsx).
const CODE_EXT: Record<string, string> = {
  txt: '', log: '', md: '', ini: '', cfg: '', conf: '', env: '', csv: '', lock: '', gitignore: '',
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx',
  py: 'py', rs: 'rs', go: 'go', java: 'java', kt: 'kotlin', cs: 'c#',
  c: 'c', h: 'c', cpp: 'c++', cc: 'c++', hpp: 'c++',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'svg', vue: 'vue',
  json: 'json', yml: 'yml', yaml: 'yaml', toml: 'toml',
  sh: 'sh', bash: 'bash', zsh: 'zsh', bat: 'cmd', ps1: 'ps1', sql: 'sql',
}
const MAX_FETCH = 1024 * 1024   // не тянем файлы больше 1 МБ
const PREVIEW_LINES = 6         // столько строк видно в превью, как в Discord

export function codeFileName(url: string): string {
  return decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'file')
}

function extOf(url: string): string {
  return (codeFileName(url).split('.').pop() ?? '').toLowerCase()
}

// Файл считается «кодовым/текстовым», если расширение из списка.
export function isCodeFile(url: string): boolean {
  return extOf(url) in CODE_EXT
}

export function CodeFileCard({ url, sizeLabel }: { url: string; sizeLabel?: string | null }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(true)      // превью развёрнуто (шеврон)
  const [whole, setWhole] = useState(false)   // «<>» — весь код прямо в карточке
  const [full, setFull] = useState(false)     // полноэкранный просмотр
  const [more, setMore] = useState(false)     // меню «…»
  const [webPreview, setWebPreview] = useState(false)   // v1.153.0: HTML как страница, не текст
  const name = codeFileName(url)
  const ext = extOf(url)
  const lang = CODE_EXT[ext] || null
  const isHtml = ext === 'html' || ext === 'htm'

  useEffect(() => {
    let on = true
    setText(null); setFailed(false); setWhole(false)
    fetch(url)
      .then(r => {
        const n = Number(r.headers.get('content-length'))
        if (n > MAX_FETCH) throw new Error('big')
        return r.text()
      })
      .then(t => { if (on) setText(t.length > MAX_FETCH ? t.slice(0, MAX_FETCH) : t) })
      .catch(() => { if (on) setFailed(true) })
    return () => { on = false }
  }, [url])

  // Esc закрывает полноэкранный просмотр (текст кода или HTML-страницу).
  useEffect(() => {
    if (!full && !webPreview) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setFull(false); setWebPreview(false) } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [full, webPreview])

  async function copyText() {
    try { await navigator.clipboard.writeText(text ?? ''); toastOk('Текст скопирован') }
    catch { toastErr('Не удалось скопировать') }
  }

  const lines = (text ?? '').split('\n')
  const preview = whole ? text ?? '' : lines.slice(0, PREVIEW_LINES).join('\n')
  const clipped = !whole && lines.length > PREVIEW_LINES

  return <div className="cfc">
    {open && text !== null && <div className={'cfc-pre' + (whole ? ' whole' : '')}>
      <pre><code>{highlight(preview, lang)}</code></pre>
      {clipped && <div className="cfc-fade" />}
    </div>}
    {open && text === null && !failed && <div className="cfc-pre cfc-loading">Загрузка…</div>}
    <div className="cfc-foot">
      <button className="cfc-chev" title={open ? 'Свернуть' : 'Развернуть'} onClick={() => setOpen(v => !v)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
      </button>
      <span className="cfc-nm" title={name}>{name}</span>
      {sizeLabel && <span className="cfc-sz">{sizeLabel}</span>}
      <span className="cfc-acts">
        <button title={whole ? 'Показать только начало' : 'Показать весь код'} disabled={text === null}
          onClick={() => { setWhole(v => !v); setOpen(true) }}><Icon name="code" size={16} /></button>
        <button title="Открыть на весь экран" disabled={text === null} onClick={() => setFull(true)}><Icon name="expand" size={16} /></button>
        <span className="cfc-more-wrap">
          <button title="Ещё" onClick={() => setMore(v => !v)}><Icon name="dots" size={16} /></button>
          {more && <>
            <div className="cfc-more-ov" onClick={() => setMore(false)} />
            <div className="cfc-more">
              {isHtml && <button onClick={() => { setMore(false); setWebPreview(true) }}>Просмотреть как страницу</button>}
              <button disabled={text === null} onClick={() => { setMore(false); copyText() }}>Скопировать текст</button>
              <button onClick={() => { setMore(false); saveMedia(url) }}>Скачать</button>
              <button onClick={() => { setMore(false); copyMediaLink(url) }}>Копировать ссылку на файл</button>
              <button onClick={() => { setMore(false); window.open(url, '_blank') }}>Открыть в браузере</button>
            </div>
          </>}
        </span>
      </span>
    </div>
    {full && text !== null && <div className="cfc-full" onClick={() => setFull(false)}>
      <div className="cfc-full-box" onClick={e => e.stopPropagation()}>
        <div className="cfc-full-head">
          <span className="cfc-nm">{name}</span>
          <span className="cfc-acts">
            <button title="Скопировать текст" onClick={copyText}><Icon name="copy" size={16} /></button>
            <button title="Скачать" onClick={() => saveMedia(url)}><Icon name="download" size={16} /></button>
            <button title="Закрыть (Esc)" onClick={() => setFull(false)}><Icon name="close" size={16} /></button>
          </span>
        </div>
        <div className="cfc-full-body"><pre><code>{highlight(text, lang)}</code></pre></div>
      </div>
    </div>}
    {webPreview && <div className="cfc-full" onClick={() => setWebPreview(false)}>
      <div className="cfc-full-box cfc-web-box" onClick={e => e.stopPropagation()}>
        <div className="cfc-full-head">
          <span className="cfc-nm">{name}</span>
          <span className="cfc-acts">
            <button title="Открыть в браузере" onClick={() => window.open(url, '_blank')}><Icon name="external" size={16} /></button>
            <button title="Закрыть (Esc)" onClick={() => setWebPreview(false)}><Icon name="close" size={16} /></button>
          </span>
        </div>
        {/* Без allow-same-origin: страница рендерится в изолированном origin —
            скрипты внутри неё не достанут ни до куки/localStorage приложения,
            ни до родительского окна. Только allow-scripts — навигация/попапы/формы
            всё ещё запрещены песочницей по умолчанию. */}
        <iframe className="cfc-web-frame" src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" title={name} />
      </div>
    </div>}
  </div>
}
