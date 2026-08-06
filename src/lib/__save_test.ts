// v1.511.0: бережный режим НА НАСТОЯЩИХ КАДРАХ. Запуск: npm run test:save
//
// Правило «когда беречь» проверяется в наборе интерфейса (npm run test:ui) —
// там чистая функция. А здесь проверяется то, ради чего всё делалось: что
// петля по кадрам ПРАВДА перестаёт работать, когда бережём, и ПРАВДА
// возвращается, когда окно снова на виду.
//
// Почему в окне браузера, а не в Node: requestAnimationFrame — это кадры
// настоящего движка. Подделка кадров таймером проверила бы мою же подделку.
import { setAnalyser, watchSpectrum, unwatchSpectrum, setSpectrumEmit } from '../music/spectrum'
import { updateGameState, resetGameState, isSaving, saving, slowMs } from './gameMode'

declare const window: any
const out: string[] = []
let pass = 0, fail = 0
const ok = (n: string) => { pass++; out.push('  ok   ' + n) }
const bad = (n: string, why?: string) => { fail++; out.push('  ПРОВАЛ ' + n + (why ? ' — ' + why : '')) }
const check = (n: string, v: boolean, extra?: string) => (v ? ok(n + (extra ? '  — ' + extra : '')) : bad(n, extra))

/** Поддельный анализатор: настоящему нужен звук, а нам нужны только кадры. */
function фальшивыйАнализатор(): any {
  return {
    frequencyBinCount: 32,
    fftSize: 64,
    getByteFrequencyData: (a: Uint8Array) => { a.fill(120) },
    getByteTimeDomainData: (a: Uint8Array) => { a.fill(128) },
  }
}

/** Сколько кадров придёт за отрезок времени. */
function считать(мс: number): Promise<number> {
  return new Promise(готово => {
    let n = 0
    setSpectrumEmit(() => { n++ })
    setTimeout(() => { setSpectrumEmit(null); готово(n) }, мс)
  })
}

async function main() {
  resetGameState()
  setAnalyser(фальшивыйАнализатор())
  watchSpectrum('проверка')

  const обычно = await считать(700)
  check('в обычной работе кадры идут', обычно > 20, 'кадров за 0,7 с: ' + обычно)

  // Человек ушёл в игру: игра запущена, окно не видно и не в фокусе.
  updateGameState({ gameRunning: true, visible: false, focused: false })
  check('режим переключился', isSaving() === true)
  await new Promise(r => setTimeout(r, 120))
  const бережём = await считать(700)
  check('пока бережём, кадров нет вовсе', бережём === 0, 'кадров за 0,7 с: ' + бережём)

  // Вернулись в окно.
  updateGameState({ visible: true, focused: true })
  check('режим выключился', isSaving() === false)
  await new Promise(r => setTimeout(r, 120))
  const вернулись = await считать(700)
  check('после возвращения кадры идут снова', вернулись > 20, 'кадров за 0,7 с: ' + вернулись)
  // Требовать РОВНО столько же нельзя: у скрытого окна частота кадров плавает
  // сама по себе, и первая моя мерка честно провалилась на 85 против 49, хотя
  // работало всё правильно. Смысл проверки в другом: поток вернулся, а не
  // капает — иначе «включили обратно» означало бы ухудшение.
  check('и это полноценный поток, а не остатки',
    вернулись > обычно * 0.4, 'было ' + обычно + ', стало ' + вернулись)

  // Игра закрыта — бережём даже со свёрнутым окном? Нет: беречь незачем.
  updateGameState({ gameRunning: false, visible: false, focused: false })
  check('без игры свёрнутое окно работает как обычно', isSaving() === false)

  out.push('')
  out.push('-- Ломаем нарочно --')
  check('проверка ловит «бережём всегда»',
    saving({ gameRunning: false, visible: false, focused: false, enabled: true }) === false)
  check('проверка ловит «не бережём никогда»',
    saving({ gameRunning: true, visible: false, focused: false, enabled: true }) === true)
  check('выключенная настройка сильнее всего',
    saving({ gameRunning: true, visible: false, focused: false, enabled: false }) === false)
  check('растяжение промежутка не трогает обычную работу',
    slowMs(60000, false) === 60000 && slowMs(60000, true) === 240000)

  unwatchSpectrum('проверка')
  out.push('')
  out.push('ИТОГ: пройдено ' + pass + ', провалено ' + fail)
  window.__saveTestDone = { text: out.join('\n'), fail }
}

void main()
