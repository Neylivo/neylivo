// v1.494.0: живая проверка озвучки. Запуск: npm run test:speak
//
// Здесь настоящий speechSynthesis настоящего браузера. Проверяется то, чего
// чистой функцией не проверить: что список голосов доезжает, что синтез правда
// начинает говорить и что выбранные настройки доходят до произнесения.
import { loadVoices, pickVoice, speak, stopSpeaking, SPEECH_DEFAULT, SPEECH_PRESETS } from './speech'

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
  ok('в браузере есть синтез речи', !!window.speechSynthesis)

  // Голосов в этот момент ещё НЕТ — и это нормально: движок синтеза
  // поднимается не сразу. Ровно поэтому loadVoices ниже и написан так, как
  // написан, а не одним getVoices().
  ok('сразу после старта список пуст — это и есть та ловушка',
    window.speechSynthesis.getVoices().length === 0,
    'сразу: ' + window.speechSynthesis.getVoices().length)

  const голоса = await loadVoices()
  ok('список голосов доехал', голоса.length > 0, 'голосов: ' + голоса.length)
  ok('у каждого есть имя и язык',
    голоса.every(v => !!v.name && !!v.lang),
    голоса.slice(0, 3).map(v => v.name + ' (' + v.lang + ')').join(', '))

  const русский = голоса.filter(v => (v.lang || '').toLowerCase().startsWith('ru'))
  lines.push('   русских голосов: ' + русский.length
    + (русский.length ? ' — ' + русский.map(v => v.name).join(', ') : ''))
  out()

  // Выбор голоса на НАСТОЯЩЕМ списке, а не на выдуманном.
  const первый = голоса[0]
  ok('выбранный голос находится по своему URI',
    pickVoice(голоса, первый.voiceURI)?.voiceURI === первый.voiceURI)
  ok('исчезнувший голос не оставляет озвучку без голоса',
    !!pickVoice(голоса, 'этого-голоса-нет-и-не-было'),
    pickVoice(голоса, 'нет')?.name ?? 'ничего')

  // ── Самое важное: синтез ПРАВДА говорит ─────────────────────────────────
  //
  // Проверяем событием start у произнесения, а не тем, что вызов не бросил
  // исключение: speak() молча ничего не делает при куче условий, и «ошибки
  // нет» тут не значит ровно ничего.
  async function сказал(текст: string, s = SPEECH_DEFAULT): Promise<boolean> {
    return new Promise(resolve => {
      let ответили = false
      const u = new SpeechSynthesisUtterance(текст)
      const v = pickVoice(голоса, s.voice)
      if (v) u.voice = v as SpeechSynthesisVoice
      u.lang = v?.lang || 'ru-RU'
      u.rate = s.rate; u.pitch = s.pitch
      u.volume = 0     // наружу не пищим, на события это не влияет
      u.onstart = () => { if (!ответили) { ответили = true; resolve(true) } }
      u.onerror = () => { if (!ответили) { ответили = true; resolve(false) } }
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
      setTimeout(() => { if (!ответили) { ответили = true; resolve(false) } }, 6000)
    })
  }

  ok('синтез начинает говорить', await сказал('Проверка связи'))
  stopSpeaking()
  await пауза(200)

  // Каждый готовый голос обязан быть произносимым: предел скорости у браузеров
  // свой, и «скороговорка» с недопустимым числом молча не заговорила бы.
  for (const п of SPEECH_PRESETS) {
    const ок = await сказал('Проверка', { ...SPEECH_DEFAULT, rate: п.rate, pitch: п.pitch })
    ok('голос «' + п.label + '» произносится', ок, `скорость ${п.rate}, высота ${п.pitch}`)
    stopSpeaking()
    await пауза(150)
  }

  // Настройки доезжают до произнесения — сверяем на самом объекте.
  {
    const u = new SpeechSynthesisUtterance('проба')
    u.rate = 1.7; u.pitch = 2
    // Сравниваем С ДОПУСКОМ: браузер хранит эти числа с одинарной точностью, и
    // 1.7 возвращается как 1.7000000476837158. Ровное сравнение здесь падало
    // бы всегда — и в приложении по той же причине выбранный готовый голос
    // переставал бы опознаваться (presetOf сравнивает с допуском ровно из-за
    // этого).
    ok('скорость и высота держатся на произнесении',
      Math.abs(u.rate - 1.7) < 0.001 && Math.abs(u.pitch - 2) < 0.001,
      `${u.rate} / ${u.pitch}`)
  }

  // И общая дорога целиком: speak() из приложения.
  const пошло = await speak('Проверка целиком', { ...SPEECH_DEFAULT, volume: 0 })
  ok('speak приложения берётся за дело', пошло)
  stopSpeaking()

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
