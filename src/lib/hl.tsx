import type { ReactNode } from 'react'

// Лёгкая подсветка синтаксиса для код-блоков ```lang — без внешних библиотек.
// Токенизатор: комментарии, строки, числа, ключевые слова, вызовы функций.
// Рендер — только безопасные React-узлы (никакого dangerouslySetInnerHTML).

const KW: Record<string, string[]> = {
  js: ['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','class','extends','super','import','from','export','default','try','catch','finally','throw','async','await','yield','typeof','instanceof','in','of','delete','void','this','null','undefined','true','false','static','get','set'],
  ts: [],
  py: ['def','return','if','elif','else','for','while','break','continue','import','from','as','class','try','except','finally','raise','with','lambda','pass','yield','global','nonlocal','assert','del','in','is','not','and','or','None','True','False','async','await','self','print'],
  rs: ['fn','let','mut','const','static','if','else','match','for','while','loop','break','continue','return','impl','trait','struct','enum','pub','use','mod','crate','self','super','where','async','await','move','ref','type','unsafe','dyn','Box','Some','None','Ok','Err','true','false'],
  go: ['func','var','const','type','struct','interface','map','chan','if','else','for','range','switch','case','break','continue','return','go','defer','select','package','import','nil','true','false','make','new','len','cap','append'],
  java: ['public','private','protected','class','interface','extends','implements','static','final','void','int','long','double','float','boolean','char','byte','short','new','return','if','else','for','while','do','switch','case','break','continue','try','catch','finally','throw','throws','import','package','this','super','null','true','false','abstract','synchronized'],
  c: ['int','long','short','char','float','double','void','unsigned','signed','struct','union','enum','typedef','const','static','extern','if','else','for','while','do','switch','case','break','continue','return','sizeof','NULL','include','define'],
  sql: ['select','from','where','and','or','not','insert','into','values','update','set','delete','create','table','alter','drop','index','join','left','right','inner','outer','on','group','by','order','having','limit','offset','as','distinct','count','sum','avg','min','max','null','is','in','like','between','exists','union','all','primary','key','foreign','references','default','unique'],
  css: ['color','background','margin','padding','border','display','position','width','height','top','left','right','bottom','flex','grid','font','text','align','justify','transform','transition','animation','opacity','overflow','cursor','z-index','content','var','important'],
  sh: ['if','then','else','elif','fi','for','in','do','done','while','case','esac','function','return','echo','cd','ls','rm','cp','mv','mkdir','export','source','sudo','npm','git','node','npx','curl'],
  html: [],
  json: ['true','false','null'],
}
const ALIAS: Record<string, string> = {
  javascript: 'js', jsx: 'js', typescript: 'js', tsx: 'js', ts: 'js', node: 'js',
  python: 'py', python3: 'py',
  rust: 'rs', golang: 'go',
  'c++': 'c', cpp: 'c', h: 'c', 'c#': 'java', cs: 'java', kotlin: 'java',
  bash: 'sh', shell: 'sh', zsh: 'sh', cmd: 'sh', powershell: 'sh', ps1: 'sh',
  postgres: 'sql', mysql: 'sql', sqlite: 'sql',
  scss: 'css', less: 'css',
  xml: 'html', svg: 'html', vue: 'html',
  yml: 'json', yaml: 'json', toml: 'json',
}

let seq = 0
const k = () => 'hl' + (seq = (seq + 1) % 1e9)

export function normLang(raw?: string | null): string | null {
  if (!raw) return null
  const l = raw.toLowerCase()
  if (KW[l]) return l
  return ALIAS[l] ?? null
}

export function highlight(code: string, rawLang?: string | null): ReactNode[] {
  const lang = normLang(rawLang)
  if (!lang) return [code]
  const kws = new Set((KW[lang] ?? []).map(w => w.toLowerCase()))
  const caseless = lang === 'sql' || lang === 'css'
  const out: ReactNode[] = []
  let i = 0
  const n = code.length
  let plain = ''
  const flush = () => { if (plain) { out.push(plain); plain = '' } }
  const push = (cls: string, s: string) => { flush(); out.push(<span key={k()} className={'hl-' + cls}>{s}</span>) }

  while (i < n) {
    const ch = code[i]
    const two = code.slice(i, i + 2)
    // комментарии
    if ((lang !== 'py' && lang !== 'sh' && two === '//') || (lang === 'sql' && two === '--')) {
      const e = code.indexOf('\n', i); const end = e === -1 ? n : e
      push('com', code.slice(i, end)); i = end; continue
    }
    if ((lang === 'py' || lang === 'sh') && ch === '#') {
      const e = code.indexOf('\n', i); const end = e === -1 ? n : e
      push('com', code.slice(i, end)); i = end; continue
    }
    if (two === '/*') {
      const e = code.indexOf('*/', i + 2); const end = e === -1 ? n : e + 2
      push('com', code.slice(i, end)); i = end; continue
    }
    if (lang === 'html' && code.slice(i, i + 4) === '<!--') {
      const e = code.indexOf('-->', i + 4); const end = e === -1 ? n : e + 3
      push('com', code.slice(i, end)); i = end; continue
    }
    // строки
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < n && code[j] !== ch) { if (code[j] === '\\') j++; j++ }
      const end = Math.min(j + 1, n)
      push('str', code.slice(i, end)); i = end; continue
    }
    // числа
    if (/[0-9]/.test(ch) && !/[\p{L}_]/u.test(code[i - 1] ?? '')) {
      let j = i
      while (j < n && /[0-9a-fA-FxX._]/.test(code[j])) j++
      push('num', code.slice(i, j)); i = j; continue
    }
    // html-теги
    if (lang === 'html' && ch === '<') {
      const m = code.slice(i).match(/^<\/?[a-zA-Z][a-zA-Z0-9-]*/)
      if (m) { push('kw', m[0]); i += m[0].length; continue }
    }
    // слова: ключевые / вызовы функций / свойства css
    if (/[\p{L}_$#@.-]/u.test(ch) && (lang !== 'css' || ch !== '.')) {
      const m = code.slice(i).match(/^[\p{L}\p{N}_$#@-]+/u)
      if (m) {
        const w = m[0]
        const wl = caseless ? w.toLowerCase() : w
        if (kws.has(wl)) push('kw', w)
        else if (code[i + w.length] === '(') push('fn', w)
        else plain += w
        i += w.length; continue
      }
    }
    plain += ch; i++
  }
  flush()
  return out
}
