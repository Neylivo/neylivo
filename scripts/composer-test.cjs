// v1.501.0: строку ввода на телефоне НЕ ОБРЕЗАЕТ. Запуск: npm run test:composer
//
// Владелец прислал снимок: печатает длинное сообщение, поле выросло на шесть
// строк — и вместо «Нормальная» видно «ормальная», а в последней строке вместо
// «сообщение» — «ообщение». Первые буквы срезаны по дуге.
//
// Причина не видна в исходнике: правило выглядит безобидно
// (border-radius: 999px, как у таблетки). Но поле РАСТЁТ вместе с текстом, и на
// высоте 130 радиус становится 65 — дуга угла заходит внутрь на тридцать
// пикселей, то есть дальше отступа в четырнадцать, и режет текст.
//
// ПОЧЕМУ ПИКСЕЛЯМИ, А НЕ ЗНАЧЕНИЕМ СВОЙСТВА. Проверка «радиус не больше
// двадцати двух» ничего не стоит: она поймала бы ровно этот случай и прошла бы
// мимо любого другого способа отрезать текст (переполнение, отрицательный
// отступ, маска). Поэтому стенд СМОТРИТ на нарисованное.
//
// КАК ИМЕННО. Рядом ставится ЭТАЛОН — второе поле с тем же текстом, шириной,
// шрифтом и отступами, но без скругления и без обрезки. Дальше в каждой строке
// СЧИТАЮТСЯ светлые пиксели и сравниваются с эталонными. Обрезанная строка
// теряет их — и неважно, чем её обрезало.
//
// Сначала я мерил проще: самый левый светлый пиксель строки. Такая мерка
// пропустила поломку на ширине 412 — дуга съела верх буквы «Н», а её ножка
// ниже осталась на прежнем месте, и «левый край» не сдвинулся. Подлог это
// показал, потому и переделано на счёт пикселей.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-composer-test')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))

// Тот самый текст со снимка владельца — длинный, чтобы поле выросло.
const ТЕКСТ = 'Нормальная летающая выбор что сделать с сообщением для телефонов ' +
  'открывающиеся внятным кликом ровно на сообщение'

// Разметка списана с Composer.tsx: плюс, таблетка поля со смайликом внутри и
// одно место справа, где лежат микрофон и синяя «отправить».
//
// Разметка здесь СВОЯ, а не настоящий компонент: поднять Composer.tsx целиком
// значит поднять и базу, и права, и плагины. Чтобы копия не разошлась с
// оригиналом, ниже отдельная проверка читает сам Composer.tsx и требует, чтобы
// эти же классы были и там.
const ряд = (id, текст, есть) => `
  <form class="composer cstyle-default" id="${id}" onsubmit="return false">
    <div class="plus-wrap"><button type="button" class="attach-btn">+</button></div>
    <div class="composer-field">
      <textarea rows="1" placeholder="Написать @guchip0n">${текст}</textarea>
      <button type="button" class="cin-emoji">&#9786;</button>
    </div>
    <div class="composer-tools"></div>
    <div class="cin-act${есть ? ' on' : ''}">
      <button type="button" class="cin-mic">&#9679;</button>
      <button type="submit" class="send-tg">&#10148;</button>
    </div>
  </form>`

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href="styles.css">
<style>html,body{margin:0;height:100%;background:#313338;font-family:system-ui,sans-serif}
/* Переменные темы задаёт приложение на ходу. Без них кольцо фокуса не
   окрашивается вовсе, и проверка «кольца нет» прошла бы, ничего не проверив. */
:root{--c-accent:#5865f2;--ov:255,255,255}</style>
<script src="keepfocus.js"></script>
<div style="position:absolute;bottom:0;left:0;right:0">
  ${ряд('пусто', '', false)}
  ${ряд('набрано', 'Тексссттттт', true)}
  <div class="composer">
    <button class="attach-btn">+</button>
    <div class="composer-field">
      <textarea id="cin" rows="1">${ТЕКСТ}</textarea>
      <button type="button" class="cin-emoji">&#9786;</button>
    </div>
    <div class="cin-act"><button class="cin-mic">&#9679;</button><button class="send-tg">&#10148;</button></div>
  </div>
</div>`)

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 60000)

/**
 * Сколько светлых пикселей в каждой строке текста.
 *
 * getBitmap отдаёт BGRA подряд, строка за строкой. Порог 120 отделяет буквы
 * (около 219) от подложки поля (около 43) — между ними нет ничего.
 */
function пикселиПоСтрокам(картинка, поле, высотаСтроки, отступСверху) {
  const { width } = картинка.getSize()
  const b = картинка.getBitmap()
  const счёт = []
  for (let n = 0; ; n++) {
    const верх = Math.round(поле.y + отступСверху + n * высотаСтроки)
    const низ = Math.round(верх + высотаСтроки)
    if (низ > поле.y + поле.height) break
    let сколько = 0
    for (let y = верх; y < низ; y++) {
      for (let x = Math.round(поле.x); x < Math.round(поле.x + поле.width); x++) {
        const i = (y * width + x) * 4
        if ((b[i] + b[i + 1] + b[i + 2]) / 3 > 120) сколько++
      }
    }
    счёт.push(сколько)
  }
  return счёт
}

app.whenReady().then(async () => {
  // backgroundThrottling: false — иначе в скрытом окне браузер режет кадры и
  // таймеры до пары в секунду, и любой переход выглядит рывком не потому, что
  // он рывок, а потому, что его некому нарисовать. На этом стенд соврал сразу.
  const win = new BrowserWindow({ show: false, width: 412, height: 560, backgroundColor: '#313338',
    webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  await new Promise(r => setTimeout(r, 400))

  for (const [имя, ширина] of [['телефон', 412], ['узкий телефон', 320]]) {
    win.setContentSize(ширина, 560)
    await new Promise(r => setTimeout(r, 250))
    // Поле растёт под текст — так же, как это делает сам Composer. Рядом
    // ставится эталон: те же ширина, шрифт и отступы, но без скругления и без
    // обрезки. Он рисуется на такой же подложке, иначе порог яркости соврёт.
    const мерка = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const t = document.getElementById('cin')
      t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'
      const s = getComputedStyle(t)
      let э = document.getElementById('ref')
      if (!э) {
        э = t.cloneNode(true); э.id = 'ref'; document.body.appendChild(э)
      }
      for (const имя of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'padding', 'width', 'color', 'backgroundColor', 'borderWidth', 'borderStyle', 'borderColor']) {
        э.style[имя] = s[имя]
      }
      э.style.position = 'absolute'; э.style.left = '0px'; э.style.top = '0px'
      э.style.borderRadius = '0'; э.style.boxSizing = s.boxSizing; э.style.resize = 'none'
      э.style.height = 'auto'; э.style.height = э.scrollHeight + 'px'
      const r = t.getBoundingClientRect(), rэ = э.getBoundingClientRect()
      return JSON.stringify({
        поле: { x: r.x, y: r.y, width: r.width, height: r.height },
        эталон: { x: rэ.x, y: rэ.y, width: rэ.width, height: rэ.height },
        строка: parseFloat(s.lineHeight), сверху: parseFloat(s.paddingTop),
        радиус: s.borderTopLeftRadius,
      })
    })()`))
    await new Promise(r => setTimeout(r, 200))
    const картинка = await win.webContents.capturePage()
    const было = пикселиПоСтрокам(картинка, мерка.поле, мерка.строка, мерка.сверху)
    const надо = пикселиПоСтрокам(картинка, мерка.эталон, мерка.строка, мерка.сверху)

    console.log('\n── ' + имя + ' (' + ширина + ') ──')
    console.log('   поле ' + Math.round(мерка.поле.height) + ' высотой, радиус ' + мерка.радиус)
    console.log('   пикселей по строкам: ' + JSON.stringify(было))
    console.log('   у эталона:           ' + JSON.stringify(надо))

    check('поле выросло под текст и эталон совпал по строкам',
      было.length >= 3 && было.length === надо.length,
      'строк ' + было.length + ', у эталона ' + надо.length)
    if (было.length >= 3 && было.length === надо.length) {
      // Допуск в 3% — на сглаживание букв: подложка у поля и у эталона одна и
      // та же, но пиксель на краю буквы может лечь на полтона иначе.
      let худшая = -1, потеря = 0
      for (let n = 0; n < было.length; n++) {
        const доля = надо[n] ? (надо[n] - было[n]) / надо[n] : 0
        if (доля > потеря) { потеря = доля; худшая = n }
      }
      check('ни одна строка не потеряла букв',
        потеря <= 0.03,
        худшая < 0 ? 'потерь нет'
          : 'строка ' + (худшая + 1) + ': ' + было[худшая] + ' вместо ' + надо[худшая] +
            ' (−' + Math.round(потеря * 100) + '%)')
    }
  }

  // ── v1.503.0: сам ряд ──────────────────────────────────────────────────
  //
  // Владелец прислал два снимка мобильного Discord: пустое поле — плюс,
  // таблетка со смайликом ВНУТРИ и микрофон, набран текст — вместо микрофона
  // синяя «отправить», и переход между ними анимацией. Просьба: «1 в 1 как на
  // примере, но без лишних кнопок».
  win.setContentSize(412, 560)
  await new Promise(r => setTimeout(r, 250))
  console.log('\n── Ряд как на снимке (412) ──')

  const места = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const где = (сел) => {
      const e = document.querySelector(сел)
      if (!e) return null
      const r = e.getBoundingClientRect(), st = getComputedStyle(e)
      return { x: r.x, y: r.y, w: r.width, h: r.height, круг: st.borderRadius,
               видно: parseFloat(st.opacity), фон: st.backgroundColor,
               справа: parseFloat(st.paddingRight) }
    }
    return JSON.stringify({
      плюс: где('#пусто .attach-btn'),
      поле: где('#пусто .composer-field'),
      текст: где('#пусто textarea'),
      смайл: где('#пусто .cin-emoji'),
      место: где('#пусто .cin-act'),
      микрофон: где('#пусто .cin-mic'),
      отправка: где('#пусто .send-tg'),
      наборМикрофон: где('#набрано .cin-mic'),
      наборОтправка: где('#набрано .send-tg'),
      лишние: document.querySelectorAll('#пусто .composer-tools button').length,
      строка: где('#пусто'),   // сам ряд и есть .composer — искать его ВНУТРИ себя нечего
    })
  })()`))

  const { плюс, поле, текст, смайл, место, микрофон, отправка } = места
  console.log('   плюс ' + Math.round(плюс.w) + 'x' + Math.round(плюс.h) +
    ', поле ' + Math.round(поле.w) + 'x' + Math.round(поле.h) +
    ', место кнопки ' + Math.round(место.w) + 'x' + Math.round(место.h))

  check('в ряду ровно три места: плюс, поле и одна кнопка', места.лишние === 0,
    'лишних кнопок в ряду: ' + места.лишние)
  check('плюс — круг', плюс.круг.startsWith('50%') && Math.abs(плюс.w - плюс.h) < 1,
    плюс.круг + ' ' + Math.round(плюс.w) + 'x' + Math.round(плюс.h))
  check('поле — таблетка во всю оставшуюся ширину',
    поле.w > места.строка.w * 0.6 && parseFloat(поле.круг) >= поле.h / 2 - 1,
    'ширина ' + Math.round(поле.w) + ' из ' + Math.round(места.строка.w) + ', скругление ' + поле.круг)
  check('смайлик ВНУТРИ поля, у правого края',
    смайл.x > поле.x && смайл.x + смайл.w <= поле.x + поле.w + 1
    && смайл.y >= поле.y - 1 && смайл.y + смайл.h <= поле.y + поле.h + 1
    && поле.x + поле.w - (смайл.x + смайл.w) < 12,
    'смайлик ' + Math.round(смайл.x) + '..' + Math.round(смайл.x + смайл.w) +
    ', поле ' + Math.round(поле.x) + '..' + Math.round(поле.x + поле.w))
  check('текст не заезжает под смайлик', текст.справа >= смайл.w + 6,
    'отступ справа ' + текст.справа + ' при смайлике ' + смайл.w)

  check('пустое поле — виден микрофон, а синей кнопки нет',
    микрофон.видно > 0.9 && отправка.видно < 0.1,
    'микрофон ' + микрофон.видно + ', отправка ' + отправка.видно)
  check('набран текст — наоборот',
    места.наборМикрофон.видно < 0.1 && места.наборОтправка.видно > 0.9,
    'микрофон ' + места.наборМикрофон.видно + ', отправка ' + места.наборОтправка.видно)
  // Сравниваются СЕРЕДИНЫ, а не левые края: синяя кнопка в этот миг уменьшена
  // и повёрнута, а рамка у повёрнутого прямоугольника шире его самого — левые
  // края разошлись бы на семь пикселей у совершенно правильной вёрстки.
  const середина = э => ({ x: э.x + э.w / 2, y: э.y + э.h / 2 })
  const см = середина(микрофон), со = середина(отправка)
  check('обе кнопки стоят на ОДНОМ месте, а не рядом',
    Math.abs(см.x - со.x) < 1.5 && Math.abs(см.y - со.y) < 1.5,
    'середины ' + Math.round(см.x) + ',' + Math.round(см.y) + ' и ' + Math.round(со.x) + ',' + Math.round(со.y))
  check('синяя — это синяя', отправка.фон.replace(/ /g, '') !== микрофон.фон.replace(/ /g, ''),
    микрофон.фон + ' -> ' + отправка.фон)

  // Плавность. Проверяется НЕ по свойству transition, а по тому, что кнопка
  // правда проходит через промежуточную прозрачность: правило может быть
  // записано и не действовать — не то свойство, не тот элемент, выключено
  // настройкой «меньше движения». Значит меряем то, что видно.
  const шаги = JSON.parse(await win.webContents.executeJavaScript(`(() => new Promise(готово => {
    const у = document.querySelector('#пусто .cin-act')
    const кнопка = у.querySelector('.send-tg')
    const ряд = []
    у.classList.add('on')
    const начало = performance.now()
    // Спрашиваем таймером, а не по кадрам: кадры зависят от того, рисует ли
    // браузер вообще, а нам нужно значение свойства во времени.
    const тик = () => {
      ряд.push(Math.round(parseFloat(getComputedStyle(кнопка).opacity) * 100) / 100)
      if (performance.now() - начало < 400) setTimeout(тик, 12)
      else готово(JSON.stringify(ряд))
    }
    тик()
  }))()`))
  const серединки = шаги.filter(v => v > 0.05 && v < 0.95)
  console.log('   прозрачность синей по кадрам: ' + шаги.slice(0, 4) + ' … ' + шаги.slice(-2))
  check('переход плавный, а не рывком', серединки.length >= 3 && шаги[шаги.length - 1] > 0.95,
    'промежуточных кадров ' + серединки.length + ', в конце ' + шаги[шаги.length - 1])

  // Копия разметки в этом стенде не должна разойтись с настоящей.
  const исходник = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Composer.tsx'), 'utf8')
  check('те же классы есть и в настоящем Composer.tsx',
    ['composer-field', 'cin-emoji', 'cin-act', 'cin-mic', 'send-tg'].every(c => исходник.includes(c)),
    'иначе стенд проверяет свою выдумку')

  // ── На компьютере всё как было ─────────────────────────────────────────
  //
  // Обёртка поля появилась ради телефона, но она есть в разметке ВЕЗДЕ. Если
  // она начнёт рисовать таблетку или занимать место на большом экране, это
  // будет поломка, которую никто не искал.
  win.setContentSize(1200, 560)
  await new Promise(r => setTimeout(r, 250))
  const стол = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('#пусто')
    const поле = c.querySelector('.composer-field'), с = c.querySelector('.send-tg')
    const ст = getComputedStyle(поле), сс = getComputedStyle(с)
    return JSON.stringify({
      фонПоля: ст.backgroundColor, скруглениеПоля: ст.borderRadius,
      отправкаВидна: сс.display, фонСтроки: getComputedStyle(c).backgroundColor,
      место: getComputedStyle(c.querySelector('.cin-act')).display,
    })
  })()`))
  console.log(`
── На компьютере (1200) ──`)
  check('обёртка поля ничего не рисует', стол.фонПоля === 'rgba(0, 0, 0, 0)',
    'фон ' + стол.фонПоля + ', скругление ' + стол.скруглениеПоля)
  check('кнопка отправки на компьютере не показывается', стол.отправкаВидна === 'none',
    'display: ' + стол.отправкаВидна)
  check('место кнопки не занимает места', стол.место === 'contents', 'display: ' + стол.место)
  check('строка ввода осталась общей капсулой', стол.фонСтроки !== 'rgba(0, 0, 0, 0)',
    'фон ' + стол.фонСтроки)

  // ── v1.510.0: клавиатура на телефоне не закрывается от кнопок ──────────
  //
  // Владелец: «написание сообщения на телефонах удобнее, как в Discord и TG».
  // Главное неудобство было тут: нажал «отправить» — фокус ушёл с поля на
  // кнопку, экранная клавиатура закрылась, лента прыгнула. Следующее сообщение
  // начиналось с повторного тычка в поле.
  //
  // Проверяется НАСТОЯЩИМ нажатием по НАСТОЯЩЕМУ помощнику: src/lib/keepFocus.ts
  // собран рядом и подключён к странице (window.KF.keepFocus). Перенос фокуса
  // делает браузер, и увидеть, отменён он или нет, можно только нажав.
  //
  // Ряд берётся «набрано»: в пустом синяя кнопка невидима и нажатий не
  // принимает вовсе — проверка по нему прошла бы, ничего не проверив. Я на
  // этом попался и сперва получил зелёную проверку ни о чём.
  // Ширину возвращаем на телефонную: на компьютере синей кнопки нет вовсе
  // (.cin-act там display:contents, а .send-tg скрыта) — нажимать было бы не по
  // чему, и проверка прошла бы, ничего не проверив. Так она у меня и «прошла».
  win.setContentSize(412, 560)
  await new Promise(r => setTimeout(r, 250))
  console.log('\n── Клавиатура остаётся открытой (412) ──')
  {
    const место = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const ряд = document.getElementById('набрано')
      const кнопка = ряд.querySelector('.send-tg')
      const r = кнопка.getBoundingClientRect()
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
    })()`))

    /** Нажать по кнопке и сказать, где остался фокус. */
    const нажать = async (сПомощником) => {
      await win.webContents.executeJavaScript(`(() => {
        const ряд = document.getElementById('набрано')
        const поле = ряд.querySelector('textarea')
        const кнопка = ряд.querySelector('.send-tg')
        кнопка.onpointerdown = ${сПомощником} ? (e => window.KF.keepFocus(e)) : null
        кнопка.onmousedown = ${сПомощником} ? (e => window.KF.keepFocus(e)) : null
        поле.focus()
        return document.activeElement.tagName
      })()`)
      // Выдержки не для красоты: без паузы после focus() нажатие приходит
      // раньше, чем фокус успел встать, и проверка «фокус ушёл» плавала —
      // проваливалась примерно в двух прогонах из трёх.
      await new Promise(r => setTimeout(r, 150))
      win.webContents.sendInputEvent({ type: 'mouseDown', x: место.x, y: место.y, button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseUp', x: место.x, y: место.y, button: 'left', clickCount: 1 })
      await new Promise(r => setTimeout(r, 350))
      return await win.webContents.executeJavaScript(`document.activeElement.tagName`)
    }

    const сНим = await нажать(true)
    check('с помощником фокус ОСТАЁТСЯ в поле — клавиатура не закроется',
      сНим === 'TEXTAREA', 'фокус стал: ' + сНим)

    // Без помощника фокус обязан уходить. Без этой половины первая ничего не
    // значит: она прошла бы и там, где кнопка просто не нажимается.
    const безНего = await нажать(false)
    check('а без него — уходит на кнопку, и это ровно та беда',
      безНего !== 'TEXTAREA', 'фокус стал: ' + безНего)
  }

  // ── v1.512.0: синего кольца вокруг строки нет ──────────────────────────
  //
  // Владелец прислал снимок: поле в фокусе — вся строка обведена синим, вместе
  // с плюсом и микрофоном. Это кольцо фокуса от стиля поля: на компьютере
  // строка и есть поле, а на телефоне поле — таблетка внутри неё.
  //
  // Состояние включается ОТЛАДЧИКОМ, а не настоящим focus(): в скрытом окне
  // :focus-within не срабатывает, и проверка проходила, ничего не проверяя, —
  // подлог со снятой починкой она пропускала.
  console.log('\n── Кольцо фокуса (412) ──')
  {
    win.setContentSize(412, 560)
    await new Promise(r => setTimeout(r, 200))
    const d = win.webContents.debugger
    if (!d.isAttached()) d.attach('1.3')
    await d.sendCommand('DOM.enable')
    await d.sendCommand('CSS.enable')
    const { root } = await d.sendCommand('DOM.getDocument')
    const { nodeId } = await d.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#пусто textarea' })
    await d.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-within'] })
    // Ждём с запасом: у строки плавная тень (transition: box-shadow), и мерка
    // раньше времени ловит середину перехода — все значения прозрачные и
    // нулевые. Подлог на этом «проходил»: сломанные стили выглядели чистыми.
    await new Promise(r => setTimeout(r, 800))

    const кольцо = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const ряд = document.getElementById('пусто')
      const s = getComputedStyle(ряд)
      const п = getComputedStyle(ряд.querySelector('.composer-field'))
      return JSON.stringify({ тень: s.boxShadow, рамка: s.borderColor + ' ' + s.borderWidth,
        фонПоля: п.backgroundColor, сработало: ряд.matches(':focus-within') })
    })()`))
    check('состояние фокуса правда включилось — иначе проверять нечего',
      кольцо.сработало === true, 'matches(:focus-within): ' + кольцо.сработало)
    const синее = /rgb\(\s*88,\s*101,\s*242|#5865f2/i
    check('строка в фокусе НЕ обводится — подсветка выключена изначально',
      !синее.test(кольцо.тень) && !синее.test(кольцо.рамка),
      'тень: ' + кольцо.тень.slice(0, 80) + ' | рамка: ' + кольцо.рамка)
    // И на ширине компьютера тоже: выпуском раньше я погасил кольцо только на
    // телефоне, и это была полумера — просили убрать, а не спрятать.
    win.setContentSize(1200, 560)
    await new Promise(r => setTimeout(r, 800))
    const наКомпьютере = await win.webContents.executeJavaScript(
      `getComputedStyle(document.getElementById('пусто')).boxShadow`)
    check('и на компьютере тоже не обводится', !синее.test(наКомпьютере),
      'тень: ' + наКомпьютере.slice(0, 80))
    // А включённая настройка кольцо возвращает: это переключатель, а не обман.
    await win.webContents.executeJavaScript(
      `document.documentElement.setAttribute('data-focusring', '1')`)
    await new Promise(r => setTimeout(r, 800))
    const включили = await win.webContents.executeJavaScript(
      `getComputedStyle(document.getElementById('пусто')).boxShadow`)
    check('включённая настройка кольцо возвращает', синее.test(включили),
      'тень: ' + включили.slice(0, 80))
    await win.webContents.executeJavaScript(
      `document.documentElement.removeAttribute('data-focusring')`)
    win.setContentSize(412, 560)
    await new Promise(r => setTimeout(r, 300))
    check('а таблетка поля осталась видимой — фокус не превратил её в пустоту',
      кольцо.фонПоля !== 'rgba(0, 0, 0, 0)', 'фон поля: ' + кольцо.фонПоля)
    await d.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
  }


  console.log('\nИТОГ: провалено ' + failed)
  // Окно закрываем ПОСЛЕ печати: закрытие последнего окна заставляет Electron
  // выйти раньше, чем вывод дойдёт до трубы.
  process.exit(failed ? 1 : 0)
})
