// Снимки НАСТОЯЩЕГО приложения для официального сайта.
//   node scripts/site-shots.mjs        (сборка + снимки, нужен electron)
//
// Отличие от look.cjs: там разметка, написанная руками «по мотивам»
// приложения, — она всегда аккуратнее настоящей, и владелец справедливо на это
// ругался. Здесь на страницу монтируется настоящий <Home/> из src/components,
// а подменён только клиент базы (src/lib/__fake_supabase.ts): подставлены
// переписка и названия каналов, а рисует всё настоящий код.
//
// Готовые снимки кладутся прямо в репозиторий сайта — ../ponoi-site/assets/shots.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ЗДЕСЬ = path.dirname(fileURLToPath(import.meta.url))
const КОРЕНЬ = path.join(ЗДЕСЬ, '..')
const ВЫХОД = path.join(КОРЕНЬ, 'dist-site-shots')
const ПОДСТАВА = path.join(КОРЕНЬ, 'src', 'lib', '__fake_supabase.ts')

mkdirSync(ВЫХОД, { recursive: true })

/**
 * Подмена клиента базы.
 *
 * Именно плагином, а не флагом --alias: alias в esbuild работает по имени
 * пакета, а тут импорт относительный ('../lib/supabase', './supabase',
 * './lib/supabase' — по-разному из разных мест). Ловим по концу пути.
 */
const подставить = {
  name: 'fake-supabase',
  setup(b) {
    b.onResolve({ filter: /(^|\/)supabase$/ }, (args) => {
      if (args.kind === 'entry-point') return null
      // Только НАШ модуль-обёртка, не пакет @supabase/supabase-js.
      if (args.path.startsWith('.')) return { path: ПОДСТАВА }
      return null
    })
  },
}

console.log('собираю…')
await build({
  entryPoints: [path.join(КОРЕНЬ, 'src', 'components', '__site_shots.tsx')],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  outfile: path.join(ВЫХОД, 'app.js'),
  plugins: [подставить],
  define: {
    // App.tsx ждёт эту подстановку от vite; без неё каркас падает на первом кадре.
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(path.join(КОРЕНЬ, 'package.json'), 'utf8')).version),
    'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'shots',
      MODE: 'production',
      DEV: false,
      PROD: true,
    }),
  },
  loader: { '.woff': 'file', '.woff2': 'file', '.jpg': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'warning',
})

// По странице на тему, а не ?theme= в адресе: загрузка file:// с запросом
// в Electron падала с ERR_FAILED через раз, и второй снимок просто не снимался.
// desktop.html — тот же стенд, но с подделанным рабочим столом: приложение
// рисует настоящую полосу заголовка, и на ней видно наложения.
for (const тема of ['dark', 'light', 'desktop']) {
  writeFileSync(path.join(ВЫХОД, тема + '.html'),
    `<!doctype html><html lang="ru" data-theme="${тема === 'desktop' ? 'dark' : тема}"><head><meta charset="utf-8">
<title>NeyLivo</title>
<link rel="stylesheet" href="app.css"></head><body data-theme="${тема === 'desktop' ? 'dark' : тема}"><div id="root"></div>
<script>
window.__ТЕМА = ${JSON.stringify(тема === 'desktop' ? 'dark' : тема)}
window.__ШУМ = ${process.env.SHOTS_NOISE ? 'true' : 'false'}
window.__РАБСТОЛ = ${тема === 'desktop' ? 'true' : 'false'}
if (window.__РАБСТОЛ) {
  // Заглушка моста: нужен только признак «это рабочий стол» и молчаливые
  // ответы на всё остальное, чтобы каркас поднялся целиком.
  window.neylivoDesktop = new Proxy({ isDesktop: true, platform: 'win32' }, {
    get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)),
  })
}
</script>
<script src="app.js"></script></body></html>`)
}

// --only-build: собрать и выйти. Этим пользуется проверка на кривости — ей
// нужна та же сборка, но снимки не нужны.
if (process.argv.includes('--only-build')) process.exit(0)

if (!existsSync(path.join(КОРЕНЬ, 'node_modules', '.bin', 'electron.cmd'))
  && !existsSync(path.join(КОРЕНЬ, 'node_modules', '.bin', 'electron'))) {
  console.error('нет electron — снимки не снять')
  process.exit(1)
}

console.log('снимаю…')
const дитя = spawn(process.platform === 'win32' ? 'node_modules\\.bin\\electron.cmd' : 'node_modules/.bin/electron',
  ['scripts/site-shots-window.cjs'], { cwd: КОРЕНЬ, stdio: 'inherit', shell: process.platform === 'win32' })
дитя.on('exit', (c) => process.exit(c ?? 0))
