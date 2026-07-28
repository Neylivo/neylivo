// v1.353.0: заливка серверных функций одной командой.
//
// Зачем. Функции лежат в supabase/functions, но в базу они не попадают — SQL и
// функции ставятся раздельно. Пока их не залить, приложение получает 404 и
// показывает «Функция «bot-create» не развёрнута». Раньше это надо было делать
// руками по одной, помня для каждой свой флаг: часть функций зовёт обычный
// вошедший человек (JWT проверяет платформа), а часть — бот или внешний скрипт,
// у которых Supabase-сессии нет и быть не может, и там платформенную проверку
// надо ОТКЛЮЧИТЬ, иначе запрос отобьётся раньше нашего кода. Перепутать флаг
// местами — либо дыра, либо «ничего не работает», поэтому список тут, а не в
// памяти человека.
//
// Запуск:  npm run deploy:functions           — все
//          npm run deploy:functions bot-create — только названные
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

// noJwt: true — платформа НЕ проверяет Authorization, функция проверяет сама.
const FUNCTIONS = [
  { name: 'bot-create', noJwt: false, why: 'создание бота — зовёт вошедший человек' },
  { name: 'bot-add-to-server', noJwt: false, why: 'добавление бота на сервер' },
  { name: 'bot-interact', noJwt: false, why: 'слэш-команда бота из поля ввода' },
  { name: 'bot-api', noJwt: true, why: 'сюда ходит сам бот с токеном «Bot <…>», сессии у него нет' },
  { name: 'bot-dispatch', noJwt: true, why: 'зовёт вебхук базы; защищён своим секретом DB_WEBHOOK_SECRET' },
  { name: 'webhook', noJwt: true, why: 'сюда шлют сторонние скрипты, токен — в самом адресе' },
  { name: 'livekit-token', noJwt: false, why: 'звонки; нужны секреты LIVEKIT_*' },
  { name: 'login-by-username', noJwt: true, why: 'вход по юзернейму — сессии ещё нет' },
  { name: 'send-push', noJwt: false, why: 'пуш-уведомления; нужны секреты VAPID_*' },
]

function projectRef() {
  // Ссылку на проект берём из .env, а не спрашиваем: она там уже есть, и просить
  // человека ввести её второй раз — лишний повод ошибиться.
  if (!existsSync('.env')) fail('нет файла .env — из него берётся адрес проекта')
  const m = readFileSync('.env', 'utf8').match(/VITE_SUPABASE_URL=\s*https:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (!m) fail('в .env не нашёлся VITE_SUPABASE_URL вида https://<ref>.supabase.co')
  // Второй раз проверяем то же самое нарочно: ниже эта строка попадает в команду
  // оболочки, и полагаться на форму одной регулярки в другом месте файла — способ
  // однажды получить в ней лишнее.
  if (!/^[a-z0-9]+$/.test(m[1])) fail('странная ссылка на проект в .env: ' + m[1])
  return m[1]
}

function fail(msg) {
  console.error('\n  ' + msg + '\n')
  process.exit(1)
}

const ref = projectRef()
const asked = process.argv.slice(2)
const known = new Set(readdirSync('supabase/functions', { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name))

// Список в скрипте и папки на диске должны совпадать: новая функция, о которой
// тут забыли, иначе просто не зальётся и найдётся только по 404 у человека.
const missed = [...known].filter(n => !FUNCTIONS.some(f => f.name === n))
if (missed.length) fail('функции есть на диске, но их нет в списке этого скрипта: ' + missed.join(', '))

const todo = asked.length
  ? FUNCTIONS.filter(f => asked.includes(f.name))
  : FUNCTIONS
if (!todo.length) fail('таких функций нет: ' + asked.join(', ') + '\n  Есть: ' + FUNCTIONS.map(f => f.name).join(', '))

console.log(`Проект: ${ref}`)
console.log(`Заливаю функций: ${todo.length}\n`)

const ok = [], bad = []
for (const f of todo) {
  // Команда собирается строкой и идёт через оболочку — иначе на Windows npx.cmd
  // не запускается вовсе (Node с некоторых пор отказывается звать .cmd напрямую).
  // Склейка тут безопасна: имя функции берётся из списка выше, а ссылка на проект
  // проверена регуляркой — в команду не попадает ничего, что ввёл человек.
  const cmd = ['npx', 'supabase', 'functions', 'deploy', f.name, '--project-ref', ref]
  if (f.noJwt) cmd.push('--no-verify-jwt')
  console.log(`── ${f.name}${f.noJwt ? '  (без проверки JWT платформой)' : ''}`)
  console.log(`   ${f.why}`)
  try {
    execSync(cmd.join(' '), { stdio: 'inherit' })
    ok.push(f.name)
  } catch {
    bad.push(f.name)
    console.log(`   !! не залилась\n`)
  }
}

console.log(`\nГотово: ${ok.length} из ${todo.length}`)
if (bad.length) {
  console.log('Не залились: ' + bad.join(', '))
  console.log('\nЕсли ошибка про вход — сначала выполни:  npx supabase login')
  console.log('(откроется браузер; либо задай переменную SUPABASE_ACCESS_TOKEN')
  console.log(' с токеном из https://supabase.com/dashboard/account/tokens)')
  process.exit(1)
}
console.log('\nОсталось задать секреты — только для тех функций, что их требуют:')
console.log('  звонки:  npx supabase secrets set --project-ref ' + ref + ' LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… LIVEKIT_URL=wss://…')
console.log('  боты:    npx supabase secrets set --project-ref ' + ref + ' DB_WEBHOOK_SECRET=<любая длинная строка>')
console.log('  пуши:    npx supabase secrets set --project-ref ' + ref + ' VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:…')
