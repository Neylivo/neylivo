// v1.493.0: как выглядит меню сообщения на телефоне. Запуск: npm run test:sheet
//
// Зачем стенд, а не проверка текста стилей. Беда здесь не в том, что правила
// нет, а в том, что одно правило перебивает другое. В мобильной шторке есть
// строка «каждый прямой ребёнок — флекс-ряд ростом в 46 пикселей», и она
// применялась ко ВСЕМУ: тонкая черта-разделитель раздувалась в пустую полосу
// высотой в палец (их три — треть шторки пустоты), а шапка с именем и текстом
// сообщения сплющивалась в одну строку. По исходнику этого не видно никак:
// оба правила на месте и оба верны по отдельности.
//
// Поэтому здесь настоящий браузер, настоящий styles.css, экран телефона — и
// измеренные ЧИСЛА.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-sheet-test')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))

const пункт = т => '<div class="ctx-item"><span>' + т + '</span></div>'

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#313338;
font-family:system-ui,sans-serif;color:#dbdee1}</style>
<div class="ctx-overlay"></div>
<div class="ctx-menu">
  <div class="ctx-head">
    <b>Ваня</b>
    <span class="ctx-head-tx">Слушай, а во сколько завтра начинаем? Я могу пораньше</span>
  </div>
  <div class="ctx-quick">
    <button>&#128077;</button><button>&#10084;</button><button>&#128514;</button><button>&#128293;</button>
  </div>
  ${пункт('Добавить реакцию')}
  <div class="ctx-sep"></div>
  ${пункт('Ответить')}
  ${пункт('Переслать')}
  <div class="ctx-sep"></div>
  ${пункт('Скопировать текст')}
  ${пункт('Закрепить сообщение')}
  <div class="ctx-sep"></div>
  <div class="ctx-item danger"><span>Удалить сообщение</span></div>
</div>`)

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

app.whenReady().then(async () => {
  // Экран телефона: мобильные правила включаются по ширине.
  const win = new BrowserWindow({ show: false, width: 412, height: 915, backgroundColor: '#313338' })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 500))

  const м = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null }
    const меню = r('.ctx-menu')
    const шапка = r('.ctx-head')
    const имя = r('.ctx-head b')
    const текст = r('.ctx-head-tx')
    const реакция = r('.ctx-quick button')
    const пункты = [...document.querySelectorAll('.ctx-item')].map(e => Math.round(e.getBoundingClientRect().height))
    const разделители = [...document.querySelectorAll('.ctx-sep')].map(e => Math.round(e.getBoundingClientRect().height))
    return JSON.stringify({
      снизу: Math.round(меню.bottom) >= innerHeight - 1,
      ширина: Math.round(меню.width), экран: innerWidth,
      высотаМеню: Math.round(меню.height),
      шапкаЕсть: !!шапка && шапка.height > 20,
      имяНадТекстом: !!имя && !!текст && имя.bottom <= текст.top + 1,
      текстВидно: текст ? Math.round(текст.width) : 0,
      пункты, разделители,
      реакцияВысота: реакция ? Math.round(реакция.height) : 0,
    })
  })()`))

  console.log('\n── Меню сообщения на телефоне ──')
  check('меню выезжает шторкой снизу', м.снизу)
  check('и занимает всю ширину экрана', Math.abs(м.ширина - м.экран) <= 2,
    м.ширина + ' из ' + м.экран)
  check('каждый пункт нажимается пальцем — не ниже 44 пикселей',
    м.пункты.length > 0 && м.пункты.every(h => h >= 44), м.пункты.join(','))
  check('разделители остаются ЧЕРТОЙ, а не пустой полосой',
    м.разделители.length > 0 && м.разделители.every(h => h <= 12), м.разделители.join(','))
  check('шапка показывает, о чём меню', м.шапкаЕсть)
  check('имя стоит НАД текстом, а не рядом с ним', м.имяНадТекстом)
  check('текст сообщения видно, а не обрезано в ничто', м.текстВидно > 150, м.текстВидно + 'px')
  check('быстрые реакции — крупные кнопки', м.реакцияВысота >= 40, м.реакцияВысота + 'px')
  // Меню не должно съедать весь экран: под ним обязано остаться видно чат.
  check('шторка не закрывает экран целиком', м.высотаМеню < 915 * 0.75,
    м.высотаМеню + ' из 915')

  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
