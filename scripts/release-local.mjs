// v1.505.0: выпуск СВОИМИ СИЛАМИ. Запуск: npm run release:local
//
// Зачем. 6 августа 2026 у GitHub лёг Actions (официальное происшествие, Actions
// и Pages — major outage). Четыре выпуска подряд не собрались: сперва «Failed to
// resolve action download info», потом «job was not acquired by Runner», а под
// конец прогоны перестали создаваться вовсе — тег на сервере есть, сборки нет.
// Владелец увидел это так: «почему последняя версия 1.502, где новые?» — и
// сказал: сделать, чтобы выпуск ни от кого не зависел.
//
// Что делает этот файл. Всю сборку установщика на этой машине, без сети (кроме
// первого раза, когда electron-builder докачивает свои части) и без чужих
// служб. На выходе — тот же самый Ponoi-Setup-<версия>.exe, что делала бы
// сборка на GitHub.
//
// ДВЕ ЛОВУШКИ, из-за которых «просто npm run dist» не работает на Windows.
//
// 1. Набор для подписи. electron-builder перед сборкой распаковывает winCodeSign
//    — а там лежат символические ссылки для macOS (libcrypto.dylib и
//    libssl.dylib). Windows не даёт обычному пользователю их создавать, 7za
//    падает, и вместе с ним падает вся сборка — на шаге, который нам не нужен
//    вовсе: сертификата у нас нет и подписывать нечем. Поэтому подпись
//    выключается ключом signAndEditExecutable=false.
//
//    Лечится это и по-другому — включить «Режим разработчика» в настройках
//    Windows, тогда ссылки создавать разрешат. Но это настройка системы, и
//    делать её за человека молча неправильно.
//
// 2. Вместе с подписью пропускается и rcedit — тот же набор правит у
//    Ponoi.exe значок, версию и название. Без него приложение получает значок и
//    версию самого Electron: в свойствах файла «31.7.7» и «Electron» вместо
//    «1.505.0» и «Ponoi». Поэтому rcedit зовётся здесь отдельно, из уже
//    распакованного кэша, и только потом собирается установщик.
//
// Чего этот путь НЕ отменяет: обновление на лету. Приложение спрашивает про
// новые версии у GitHub Releases (electron/../app-update.yml), и пока файл не
// выложен туда, само оно не обновится. Полная независимость и здесь означает
// свой адрес для обновлений — это решение владельца, а не мелкая правка.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const КОРЕНЬ = path.resolve(import.meta.dirname, '..')
const ВЫХОД = path.join(КОРЕНЬ, 'release')
const версия = JSON.parse(readFileSync(path.join(КОРЕНЬ, 'package.json'), 'utf8')).version

const шаг = (t) => console.log('\n── ' + t + ' ──')
const беги = (cmd, args) => execFileSync(cmd, args, { cwd: КОРЕНЬ, stdio: 'inherit', shell: true })

/**
 * Найти rcedit в кэше electron-builder. Он лежит в winCodeSign — том самом
 * наборе, распаковка которого падает на символических ссылках. Но падает она
 * ПОСЛЕ того, как всё нужное уже распаковано, поэтому rcedit на диске есть.
 * Нет — не беда: соберём без правки значка и скажем об этом вслух.
 */
function найтиRcedit() {
  const кэш = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign')
  if (!existsSync(кэш)) return null
  for (const d of readdirSync(кэш)) {
    const p = path.join(кэш, d, 'rcedit-x64.exe')
    if (existsSync(p)) return p
  }
  return null
}

шаг('Сборка веб-части (версия ' + версия + ')')
беги('node', ['scripts/gen-changelog.mjs'])
беги('npx', ['vite', 'build'])

// ПОЧЕМУ ЗДЕСЬ ПОЛНАЯ СБОРКА, А НЕ ТОЛЬКО УПАКОВКА (--dir).
//
// Сначала я ставил сюда `--dir`: зачем собирать установщик дважды. И получил
// установщик, у которого приложение НЕ УМЕЕТ ПРОВЕРЯТЬ ОБНОВЛЕНИЯ: настройки
// обновления (resources/app-update.yml) electron-builder кладёт в приложение на
// шаге сборки цели, а не упаковки. При `--dir` файла нет, а `--prepackaged`
// берёт папку как есть — и его не появляется уже нигде.
//
// Видно это было только запуском собранного приложения: в его вывод падало
// «ENOENT: app-update.yml», а окно при этом открывалось как ни в чём не бывало.
// Поэтому здесь полная сборка: она и настройки положит, и установщик соберёт —
// пусть и со значком Electron, который следующим шагом поправит rcedit.
шаг('Упаковка приложения')
беги('npx', ['electron-builder', '--win', '-c.win.signAndEditExecutable=false'])

const exe = path.join(ВЫХОД, 'win-unpacked', 'Ponoi.exe')
if (!existsSync(exe)) throw new Error('приложение не собралось: нет ' + exe)
// Без этого файла приложение не узнает о новых версиях. Молчать нельзя: с виду
// такая сборка совершенно исправна, и человек заметит беду через месяц, когда
// обновление не придёт.
const настройкиОбновления = path.join(ВЫХОД, 'win-unpacked', 'resources', 'app-update.yml')
if (!existsSync(настройкиОбновления)) {
  throw new Error('в сборке нет resources/app-update.yml — установленное приложение не сможет проверять обновления')
}

шаг('Значок, версия и название у Ponoi.exe')
const rcedit = найтиRcedit()
if (rcedit) {
  беги(rcedit, [
    JSON.stringify(exe),
    '--set-icon', JSON.stringify(path.join(КОРЕНЬ, 'build', 'icon.ico')),
    '--set-file-version', версия,
    '--set-product-version', версия,
    '--set-version-string', 'ProductName', 'Ponoi',
    '--set-version-string', 'FileDescription', 'Ponoi',
    '--set-version-string', 'CompanyName', 'Ponoi',
    '--set-version-string', 'LegalCopyright', 'Ponoi',
  ])
} else {
  console.log('  rcedit не найден в кэше — приложение получит значок и версию Electron.')
  console.log('  Это единственное, что теряется: работать оно будет так же.')
}

шаг('Установщик заново — уже с правильным значком')
беги('npx', ['electron-builder', '--win', 'nsis', '--prepackaged', 'release/win-unpacked',
  '-c.win.signAndEditExecutable=false'])

шаг('Итог')
const файлы = readdirSync(ВЫХОД)
  .filter(f => f.endsWith('.exe'))
  .map(f => path.join(ВЫХОД, f))
if (!файлы.length) throw new Error('установщик не собрался')

// Отпечатки — чтобы человек мог убедиться, что скачал именно этот файл.
const строки = []
for (const f of файлы) {
  const h = createHash('sha256').update(readFileSync(f)).digest('hex')
  const мб = (statSync(f).size / 1e6).toFixed(1)
  строки.push(h + '  ' + path.basename(f) + '  (' + мб + ' МБ)')
  console.log('  ' + path.basename(f) + ' — ' + мб + ' МБ')
  console.log('    sha256 ' + h)
}
writeFileSync(path.join(ВЫХОД, 'CHECKSUMS.txt'), строки.join('\n') + '\n')

console.log('\nГотово. Файлы лежат в ' + ВЫХОД)
console.log('Установщик можно отдавать как есть — он ни от чего снаружи не зависит.')
console.log('Чтобы приложение обновилось само, тот же файл должен попасть в релиз на GitHub.')
