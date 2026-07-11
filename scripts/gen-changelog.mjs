#!/usr/bin/env node
// Автогенерация записей «Что нового» (v1.154.0). Раньше src/lib/changelog.ts
// дописывался вручную при каждом релизе и стабильно отставал от реальных версий
// (на момент написания этого скрипта — на 7 версий). Коммиты релизов уже пишутся
// в формате "vX.Y.Z: <текст для пользователя>" (это часть протокола версии —
// см. release-and-versioning), так что запись для «Что нового» можно взять прямо
// из истории git, вручную ничего больше трогать не нужно. Запускается перед
// каждой сборкой (см. "build"/"dist" в package.json), поэтому и веб/PWA,
// и десктоп-релиз всегда получают актуальный список без отдельного шага.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
const CHANGELOG_PATH = path.join(REPO_ROOT, 'src', 'lib', 'changelog.ts')

// Разделяем текст коммита на пункты списка только по ';' и ' + ' — по тем
// местам, где разработчик сам явно разделил перечисление разных изменений.
// Запятую НЕ используем как разделитель: в русских формулировках запятая
// слишком часто значит "и" внутри одной мысли ("ни X, ни Y"), а не границу
// пунктов — разбивка по ней даёт мусорные обрывки фраз.
function splitItems(desc) {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < desc.length; i++) {
    const c = desc[i]
    if (c === '(' || c === '«') depth++
    else if (c === ')' || c === '»') depth = Math.max(0, depth - 1)
    if (depth === 0 && c === ';') { parts.push(cur); cur = ''; continue }
    if (depth === 0 && desc.slice(i, i + 3) === ' + ') { parts.push(cur); cur = ''; i += 2; continue }
    cur += c
  }
  parts.push(cur)
  return parts.map(s => s.trim().replace(/^[-—]\s*/, '')).filter(Boolean)
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT })
}

let raw
try {
  // %x1f — литеральный байт-разделитель полей git pretty-format (не JS-escape).
  raw = sh('git log --format=%H%x1f%ad%x1f%s --date=short')
} catch {
  console.warn('[gen-changelog] git log недоступен (не git-репозиторий / нет истории) — пропускаю')
  process.exit(0)
}

const VER_RE = /^v(\d+\.\d+\.\d+):\s*(.+)$/
const commits = raw.split('\n').filter(Boolean).map(line => {
  const [, date, subject] = line.split('\x1f')
  const m = subject && subject.match(VER_RE)
  return m ? { version: m[1], date, desc: m[2].trim() } : null
}).filter(Boolean)

let existing
try { existing = readFileSync(CHANGELOG_PATH, 'utf8') }
catch { console.warn('[gen-changelog] ' + CHANGELOG_PATH + ' не найден — пропускаю'); process.exit(0) }

const knownVersions = new Set([...existing.matchAll(/version:\s*"([\d.]+)"/g)].map(m => m[1]))

function verParts(v) { return v.split('.').map(Number) }
function verCmp(a, b) {
  const pa = verParts(a), pb = verParts(b)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
  return 0
}
const maxKnown = [...knownVersions].reduce((max, v) => (verCmp(v, max) > 0 ? v : max), '0.0.0')

// git log уже отдаёт коммиты от новых к старым — то же направление, что и у
// массива CHANGELOG (новые версии сверху). Добавляем только версии НОВЕЕ уже
// известного максимума — так подтягиваются лишь свежие релизы, а старая
// история (её когда-то сознательно завели не с самого начала проекта) не
// перезаписывается сотнями древних записей при первом запуске скрипта.
const fresh = commits.filter(c => !knownVersions.has(c.version) && verCmp(c.version, maxKnown) > 0)
if (fresh.length === 0) {
  console.log('[gen-changelog] новых версий нет, changelog.ts не тронут')
  process.exit(0)
}

// v1.233.0: с v1.231.0 действует конвенция — каждый пункт коммита начинается с
// "Добавлено:"/"Исправлено:"/"Убрано:"/"Изменено:" (безличная форма, не от лица
// автора) либо это техническое обслуживание сборки без пользовательской сути.
// Раньше сюда ничего не проверяло — коммит без префикса (не тот регистр, не тот
// язык) молча попадал в changelog.ts как есть, ломая единообразие «Что нового».
const PREFIX_RE = /^(Добавлено|Исправлено|Убрано|Изменено|Техническ\w+)[:\s]/
for (const c of fresh) {
  const items = splitItems(c.desc)
  const bad = items.filter(it => !PREFIX_RE.test(it))
  if (bad.length > 0) {
    console.error('[gen-changelog] v' + c.version + ': текст коммита не начинается с «Добавлено:/Исправлено:/Убрано:/Изменено:» —')
    for (const b of bad) console.error('  ' + JSON.stringify(b))
    console.error('Поправь заголовок коммита (или сделай пустой --amend только заголовка) и пересобери.')
    process.exit(1)
  }
}

// Файл в CRLF (Windows-репозиторий) — подстраиваемся, чтобы не намешать \n
// туда, где везде \r\n, и не потерять маркер из-за несовпадения переноса строки.
const nl = existing.includes('\r\n') ? '\r\n' : '\n'
const entries = fresh.map(c => {
  const items = splitItems(c.desc)
  const itemsLit = items.map(it => JSON.stringify(it)).join(', ')
  return `  { version: "${c.version}", date: "${c.date}", items: [${itemsLit}] },`
}).join(nl)

const marker = 'export const CHANGELOG: ChangelogEntry[] = ['
const idx = existing.indexOf(marker)
if (idx === -1) {
  console.warn('[gen-changelog] не нашёл маркер массива CHANGELOG в файле — пропускаю, ничего не трогаю')
  process.exit(0)
}
// Вставляем сразу после "[" и его перевода строки (учитывая \r\n целиком, не разрывая его).
let insertAt = idx + marker.length
while (existing[insertAt] === '\r' || existing[insertAt] === '\n') insertAt++
const updated = existing.slice(0, insertAt) + entries + nl + existing.slice(insertAt)
writeFileSync(CHANGELOG_PATH, updated, 'utf8')
console.log('[gen-changelog] добавлено версий: ' + fresh.length + ' (' + fresh.map(c => c.version).join(', ') + ')')
