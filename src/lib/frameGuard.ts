// v1.557.0 (находка F4 аудита): приложение не работает внутри чужой рамки.
//
// ЗАЧЕМ. От встраивания в чужую страницу защищает `frame-ancestors 'none'` —
// но эта директива работает ТОЛЬКО заголовком ответа, в <meta> браузер её
// игнорирует по спецификации. Веб-версия живёт на GitHub Pages, а там заголовки
// не задать. То есть выбор простой: либо чужой сайт может вложить Ponoi в
// прозрачную рамку и водить рукой человека по чужим кнопкам (перехват нажатий),
// либо приложение само отказывается работать во вложении.
//
// ЧТО ДЕЛАЕТ. Если документ не самый верхний — сначала честная попытка выйти
// наверх (сработает, если рамка не запрещает навигацию верхнего уровня), а если
// не вышло, приложение не запускается вовсе и человек видит, куда идти.
//
// Под Electron этого не происходит никогда: там документ всегда верхний.

/** Верхний ли мы документ. Обращение к window.top через границу происхождения
 *  само по себе безопасно — сравнение ссылок исключения не бросает. */
export function вРамке(): boolean {
  try { return window.top !== window.self } catch { return true }
}

/** Вернуть true, если приложение запускать нельзя. */
export function держатьРамку(): boolean {
  if (!вРамке()) return false
  // Попытка выйти наверх. В рамке с sandbox без allow-top-navigation бросит
  // исключение — тогда просто не запускаемся.
  try { window.top!.location.replace(window.location.href); return true } catch { /* нельзя — ниже */ }

  document.title = 'Ponoi'
  const поставить = () => {
    // Собирается узлами, а не строкой с innerHTML. Причина не в придирчивости:
    // в подпись пришлось бы вставить window.location.href, а его содержимое
    // задаёт тот, кто нас встроил, — то есть строка с разметкой стала бы ровно
    // тем способом внедрения кода, от которого эта страница и защищает.
    const обёртка = document.createElement('div')
    обёртка.setAttribute('style', 'min-height:100vh;display:flex;align-items:center;justify-content:center;'
      + 'background:#1e1f22;color:#dbdee1;font:16px/1.5 system-ui,sans-serif;padding:24px')
    const внутри = document.createElement('div')
    внутри.setAttribute('style', 'max-width:34rem;text-align:center')
    const имя = document.createElement('div')
    имя.setAttribute('style', 'font-size:28px;font-weight:800;color:#fff;margin-bottom:12px')
    имя.textContent = 'Ponoi'
    const текст = document.createElement('p')
    текст.setAttribute('style', 'margin:0 0 16px')
    текст.textContent = 'Эта страница открыта внутри чужого сайта, и Ponoi так не работает: '
      + 'встроенное окно позволяет подставлять нажатия мимо вашего ведома.'
    const строка = document.createElement('p')
    строка.setAttribute('style', 'margin:0')
    const ссылка = document.createElement('a')
    ссылка.href = window.location.href
    ссылка.target = '_blank'
    ссылка.rel = 'noopener noreferrer'
    ссылка.setAttribute('style', 'color:#8ea1ff')
    ссылка.textContent = 'Открыть Ponoi отдельной вкладкой'
    строка.appendChild(ссылка)
    внутри.append(имя, текст, строка)
    обёртка.appendChild(внутри)
    document.body.replaceChildren(обёртка)
  }
  if (document.body) поставить()
  else document.addEventListener('DOMContentLoaded', поставить)
  return true
}
