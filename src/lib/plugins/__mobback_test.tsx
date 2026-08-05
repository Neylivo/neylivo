// v1.489.0: на телефоне окно плагина закрывает системная «назад».
// Запуск: npm run test:mobback
//
// Зачем отдельный стенд. У безрамочного окна не осталось НИЧЕГО нашего: ни
// шапки, ни крестика — так решил владелец («не надо бояться, главное чтобы не
// было лишнего»). На компьютере выход есть — Esc. На телефоне клавиатуры нет, и
// единственная кнопка, которая там есть всегда, — системная «назад». То есть
// эта проверка стережёт последний выход из полноэкранного окна плагина: если
// она упадёт, человек с телефона не сможет закрыть его вообще ничем.
//
// Почему не в общей проверке возможностей (test:api). Всё это включается только
// при IS_MOBILE, а он считается ОДИН раз при загрузке по опознавателю браузера.
// Значит, нужно отдельное окно Electron, которое представляется Android
// (scripts/mobback-test.cjs), — иначе проверка молча шла бы по ветке «компьютер»
// и ничего не проверяла.
import { createRoot } from 'react-dom/client'
import { PluginApps } from '../../components/PluginApps'
import { openApp, appList, clearAllApps } from './apps'
import { IS_MOBILE } from '../mobile'
import { backTrapDepth } from '../mobileBack'

const lines: string[] = []
let failed = 0
const out = () => { document.getElementById('out')!.textContent = lines.join('\n') }
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  lines.push(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
  out()
}
const пауза = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  createRoot(document.getElementById('root')!).render(<PluginApps />)
  await пауза(300)

  // Первое и главное: мы точно в телефонной ветке. Без этого всё ниже прошло бы
  // «зелёным» и не проверило ничего — та самая проверка, которая не умеет падать.
  ok('стенд считается телефоном', IS_MOBILE, 'IS_MOBILE=' + String(IS_MOBILE))
  const глубина0 = backTrapDepth()

  // Безрамочное окно во весь экран — худший случай: закрыть его нечем, кроме
  // «назад».
  const a = openApp('проба', {
    title: 'Голое', mode: 'fullscreen', icon: 'star', rows: [],
    frameless: true, transparent: true,
  })
  await пауза(300)

  const узел = () => document.querySelector('.plugapp') as HTMLElement | null
  ok('окно нарисовано', !!узел())
  ok('нашего в нём нет ничего',
    !узел()?.querySelector('.plugapp-h') && !узел()?.querySelector('.plugapp-x'))
  ok('«назад» взята под окно', backTrapDepth() === глубина0 + 1,
    'ловушек: ' + backTrapDepth())

  // Настоящая «назад»: на Android она уходит в историю WebView, а мы её ловим.
  history.back()
  for (let i = 0; i < 60 && appList('проба').length > 0; i++) await пауза(50)

  ok('«назад» закрыла окно плагина', appList('проба').length === 0,
    'окон осталось: ' + appList('проба').length)
  ok('и с экрана оно тоже ушло', !узел())
  ok('ловушка снялась вместе с окном', backTrapDepth() === глубина0,
    'ловушек: ' + backTrapDepth())

  // Второе окно поверх первого: «назад» должна снимать ВЕРХНЕЕ, а не оба разом.
  const н = openApp('проба', { title: 'Первое', mode: 'window', icon: 'star', rows: [] })
  await пауза(200)
  openApp('проба', { title: 'Второе', mode: 'window', icon: 'star', rows: [] })
  await пауза(200)
  ok('двух окон — две ловушки', backTrapDepth() === глубина0 + 2, 'ловушек: ' + backTrapDepth())
  history.back()
  for (let i = 0; i < 60 && appList('проба').length > 1; i++) await пауза(50)
  ok('«назад» закрыла одно окно, а не оба',
    appList('проба').length === 1 && appList('проба')[0].id === н.id,
    'осталось: ' + appList('проба').map(x => x.title).join(','))

  clearAllApps()
  await пауза(200)
  lines.push('')
  lines.push(`ИТОГ: пройдено ${lines.filter(l => l.startsWith('OK')).length}, провалено ${failed}`)
  out()
  ;(window as any).__failed = failed
  ;(window as any).__done = true
}

main().catch(e => {
  lines.push('УПАЛО: ' + (e?.message ?? e))
  out()
  ;(window as any).__failed = 1
  ;(window as any).__done = true
})
