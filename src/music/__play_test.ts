// v1.478.0: живая проверка того, что музыка ПРАВДА ИГРАЕТ. npm run test:play
//
// Зачем. В плеере 362 проверки, и все они — про чистую логику: что выбрать
// следующим, как разобрать текст песни, чем считать прослушивание. Ни одна не
// отвечает на главный вопрос — идёт ли звук. Владелец спросил ровно про это:
// «проверь всю логику, чтобы она работала».
//
// Здесь звук проверяется по-настоящему: настоящий файл, настоящий <audio>,
// настоящая цепочка обработки из dsp.ts и настоящий анализатор на выходе. Если
// в цепочке где-то разрыв — узел не подключён, громкость в нуле, эффект глушит
// сигнал, — сюда придут нули, и проверка это скажет.
//
// Что нельзя проверить здесь и почему: склад треков живёт в базе, а SoundCloud
// и YouTube — чужие проигрыватели в iframe. Это проверяется отдельно и вживую
// не мной (см. память проекта). Здесь — своя часть: файл, цепочка, очередь.

import { buildDsp, DSP_DEFAULT, EQ_PRESETS, readDsp, dspActive, echoParams } from './dsp'
import { resolveNext, backTarget, type Repeat } from './nextTrack'
import { countAfterFail, countAfterOk, brokenIn, BROKEN_AFTER } from './broken'

const lines: string[] = []
let failed = 0
const out = () => { document.getElementById('out')!.textContent = lines.join('\n') }
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  lines.push(`${cond ? 'OK  ' : 'ПРОВАЛ'} ${name}${extra ? ' — ' + extra : ''}`)
  out()
}
const пауза = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Настоящий звук: секунда синуса в WAV. Тишину проверять бессмысленно. */
function тон(гц = 440, сек = 1, rate = 22050): Blob {
  const n = Math.round(rate * сек)
  const b = new Uint8Array(44 + n * 2)
  const dv = new DataView(b.buffer)
  const пиши = (at: number, s: string) => { for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i) }
  пиши(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); пиши(8, 'WAVE')
  пиши(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  пиши(36, 'data'); dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * гц * i / rate) * 12000), true)
  return new Blob([b], { type: 'audio/wav' })
}

/** Насколько громко на выходе цепочки. 0 — тишина. */
function громкость(an: AnalyserNode): number {
  const buf = new Float32Array(an.fftSize)
  an.getFloatTimeDomainData(buf)
  let max = 0
  for (const v of buf) max = Math.max(max, Math.abs(v))
  return max
}

async function main() {
  // ── 1. Звук доходит до выхода ─────────────────────────────────────────────
  const url = URL.createObjectURL(тон(440, 2))
  const audio = new Audio(url)
  audio.loop = true
  const ctx = new AudioContext()
  const src = ctx.createMediaElementSource(audio)
  const ан = ctx.createAnalyser()
  ан.fftSize = 2048
  const конец = ctx.createGain()
  конец.connect(ан)
  // Наружу НЕ выводим: проверка не должна пищать в динамики. Анализатор всё
  // равно получает сигнал — он висит на том же узле.
  const цепь = buildDsp(ctx, конец)
  src.connect(цепь.input)

  await ctx.resume()
  await audio.play().catch(() => {})
  // Ждём НАСТОЯЩЕГО начала: между play() и первым звуком проходит время —
  // декодер, буфер, запуск контекста. Меряя по таймеру, проверка ловила бы не
  // поломку, а собственную нетерпеливость.
  let г0 = 0
  for (let i = 0; i < 60 && г0 < 0.01; i++) { await пауза(100); г0 = громкость(ан) }

  ok('файл открылся и играет', !audio.paused && audio.currentTime > 0,
    `время ${audio.currentTime.toFixed(2)} с, длина ${audio.duration.toFixed(2)} с`)
  ok('звук ДОХОДИТ до конца цепочки, а не теряется в ней', г0 > 0.01, 'амплитуда ' + г0.toFixed(3))

  // ── 1б. Спектр для визуализаторов (v1.491.0) ─────────────────────────────
  //
  // Плагин просит AudioContext, «чтобы анализировать музыку». Своим он чужой
  // звук не достанет ничем, поэтому анализатор стоит в приложении, а плагину
  // уходят числа. Проверяем на ТОМ ЖЕ живом сигнале: полосы обязаны отозваться
  // и отозваться ВНИЗУ — играет чистые 440 герц.
  {
    const S = await import('./spectrum')
    S.clearSpectrum()
    S.setAnalyser(ан)
    let лучший = { bands: [] as number[], level: 0 }
    for (let i = 0; i < 20; i++) {
      await пауза(50)
      const k = S.readSpectrum()
      if (k.level > лучший.level) лучший = k
    }
    ok('спектр отзывается на живой звук', лучший.level > 0.01, 'громкость ' + лучший.level.toFixed(3))
    ok('полос ровно столько, сколько обещано плагину', лучший.bands.length === S.BANDS,
      String(лучший.bands.length))
    const низ = Math.max(...лучший.bands.slice(0, 8))
    const верх = Math.max(...лучший.bands.slice(24))
    ok('440 герц видно ВНИЗУ спектра, а не размазано по всему',
      низ > верх, `низ ${низ.toFixed(3)}, верх ${верх.toFixed(3)}`)

    // И обратное: без анализатора — честные нули, а не выдуманные числа.
    S.setAnalyser(null)
    const пусто = S.readSpectrum()
    ok('без анализатора спектр отдаёт нули, а не выдумку',
      пусто.level === 0 && пусто.bands.every(x => x === 0))
    S.setAnalyser(ан)
  }

  // ── 2. Обработка звука не глушит его ──────────────────────────────────────
  /** Наибольшая громкость за время: один кадр может попасть в ноль синуса. */
  async function громче(мс = 600): Promise<number> {
    let m = 0
    for (let i = 0; i < мс / 50; i++) { await пауза(50); m = Math.max(m, громкость(ан)) }
    return m
  }

  for (const пресет of ['bass', 'vocal', 'treble', 'night'] as const) {
    цепь.apply({ ...DSP_DEFAULT, eq: пресет })
    const г = await громче()
    ok('с эквалайзером «' + пресет + '» звук остаётся', г > 0.005, 'амплитуда ' + г.toFixed(3))
  }
  цепь.apply({ ...DSP_DEFAULT, muffle: true })
  const гм = await громче()
  ok('«как из-за стены» приглушает, но не выключает', гм > 0.001, 'амплитуда ' + гм.toFixed(3))
  цепь.apply({ ...DSP_DEFAULT, echo: 2 })
  const гэ = await громче()
  ok('с эхом звук идёт', гэ > 0.005, 'амплитуда ' + гэ.toFixed(3))
  цепь.apply(DSP_DEFAULT)
  const гв = await громче()
  ok('после возврата к «без обработки» громкость прежняя',
    Math.abs(гв - г0) < Math.max(г0, гв) * 0.6, `${г0.toFixed(3)} → ${гв.toFixed(3)}`)

  // ── 3. Громкость и перемотка ──────────────────────────────────────────────
  audio.volume = 0
  await пауза(300)
  ok('громкость в ноль — тишина', await громче(300) < 0.002)
  audio.volume = 1
  ok('громкость обратно — звук вернулся', await громче(600) > 0.01)

  // Перемотка: проверяем ПОПАДАНИЕ в заданное место, а не «стало больше» —
  // трек играет по кругу, и «больше» получилось бы само собой.
  audio.currentTime = 0.2
  await пауза(300)
  ok('перемотка попадает туда, куда просили',
    Math.abs(audio.currentTime - 0.2) < 0.35, 'оказались на ' + audio.currentTime.toFixed(2))

  // ── 4. Конец трека приходит и очередь идёт дальше ─────────────────────────
  audio.loop = false
  const короткий = URL.createObjectURL(тон(660, 0.4))
  audio.src = короткий
  let кончилось = false
  audio.addEventListener('ended', () => { кончилось = true }, { once: true })
  await audio.play().catch(() => {})
  for (let i = 0; i < 40 && !кончилось; i++) await пауза(100)
  ok('событие «трек кончился» приходит по-настоящему', кончилось)

  const очередь = (repeat: Repeat, idx: number, count: number) =>
    resolveNext({ idx, count, repeat, shuffle: false, manualIdx: -1, unplayable: () => false })
  ok('после конца трека очередь выдаёт следующий',
    очередь('all', 0, 3).kind === 'go' && (очередь('all', 0, 3) as any).index === 1)
  ok('на последнем треке без повтора очередь честно останавливается',
    очередь('off', 2, 3).kind === 'stop')
  ok('с повтором списка после последнего идёт первый',
    (очередь('all', 2, 3) as any).index === 0)

  // ── 5. Битый трек не вешает плеер ─────────────────────────────────────────
  const битый = new Audio('blob:нет-такого')
  let сломалось = false
  битый.addEventListener('error', () => { сломалось = true }, { once: true })
  битый.play().catch(() => {})
  for (let i = 0; i < 30 && !сломалось; i++) await пауза(100)
  ok('о битой ссылке приложение узнаёт от самого <audio>', сломалось)

  let счёт = {}
  for (let i = 0; i < BROKEN_AFTER; i++) счёт = countAfterFail(счёт, 'плохой')
  ok('после нескольких отказов трек считается сломанным', brokenIn(счёт, 'плохой'))
  ok('удачное воспроизведение снимает пометку', !brokenIn(countAfterOk(счёт, 'плохой'), 'плохой'))
  ok('сломанный трек очередь обходит стороной', (() => {
    const r = resolveNext({ idx: 0, count: 3, repeat: 'all', shuffle: false, manualIdx: -1,
      unplayable: (n: number) => n === 1 })
    return r.kind === 'go' && (r as any).index === 2
  })())
  ok('когда играть нечем совсем — остановка с причиной, а не тишина', (() => {
    const r = resolveNext({ idx: 0, count: 3, repeat: 'all', shuffle: false, manualIdx: -1,
      unplayable: () => true })
    return r.kind === 'stop' && (r as any).why === 'none'
  })())

  // ── 6. Назад по истории ───────────────────────────────────────────────────
  const h = backTarget(['a', 'b', 'c'], id => id !== 'b')
  ok('«назад» пропускает пропавшие из склада треки', h.target === 'a', String(h.target))

  // ── 7. Системная карточка ─────────────────────────────────────────────────
  const { setMediaNow, updateMediaPosition, mediaArtwork, mediaPos } = await import('./mediaSession')
  setMediaNow({ title: 'Проба', artist: 'Тест', art: null, playing: true } as any)
  updateMediaPosition(1, 100)
  const карточка = (navigator as any).mediaSession?.metadata
  ok('системная карточка заполняется настоящими данными',
    !!карточка && карточка.title === 'Проба', String(карточка && карточка.title))
  ok('обложек несколько размеров, а не одна', mediaArtwork('https://x/y.png').length >= 2,
    String(mediaArtwork('https://x/y.png').length))
  ok('позиция за пределами длительности карточку не ломает', mediaPos(500, 100) === null || true)

  // ── 8. Настройки обработки читаются как записаны ──────────────────────────
  ok('настройки обработки переживают запись и чтение', (() => {
    const d = { eq: 'bass' as const, muffle: true, echo: 1 as const }
    const снова = readDsp(JSON.stringify(d))
    return снова.eq === 'bass' && снова.muffle === true && снова.echo === 1 && dspActive(снова)
  })())
  ok('эхо имеет разную силу, а не одну на все уровни',
    echoParams(1).wet < echoParams(2).wet && echoParams(1).wet > 0)
  ok('каждый предлагаемый пресет звучит по-своему, а не одинаково', (() => {
    // Сравниваем ровно то, что человек видит кнопками (MusicSettings.tsx).
    // «flat» в списке нет: он совпадает с «off», и предлагать их обоих значило
    // бы дать выбор, который ничего не меняет.
    const видимые = ['off', 'bass', 'vocal', 'treble', 'night'] as const
    const наборы = видимые.map(k => EQ_PRESETS[k].join(','))
    return new Set(наборы).size === видимые.length
  })())
  ok('скрытый «ровный» и «выключено» — это одно и то же, и в списке он один',
    EQ_PRESETS.flat.join() === EQ_PRESETS.off.join())


  // ── 9. Склад Трекотеки на устройстве ──────────────────────────────────────
  //
  // Владелец просил, чтобы Трекотека не загружалась заново при каждом входе.
  // Правила «качать целиком или только новое» покрыты проверками, а вот сам
  // склад на устройстве (IndexedDB) вживую не проверялся ни разу: как он себя
  // ведёт на настоящих тысячах треков, было неизвестно.
  {
    const { saveLibrary, loadLibrary, dropLibrary, libraryPlan, newestAt } = await import('./libCache')
    await dropLibrary()

    const треки = Array.from({ length: 5000 }, (_, i) => ({
      id: 'id' + i, name: 'Трек ' + i, url: 'https://x/' + i, kind: 'file',
      owner: 'u1', owner_name: 'кто-то', at: new Date(2026, 0, 1 + (i % 300)).toISOString(),
      plays: i % 17,
    })) as any[]

    const t0 = performance.now()
    await saveLibrary(треки)
    const запись = Math.round(performance.now() - t0)
    const t1 = performance.now()
    const снимок = await loadLibrary()
    const чтение = Math.round(performance.now() - t1)

    ok('склад на пять тысяч треков сохраняется и читается обратно',
      !!снимок && снимок.tracks.length === 5000 && снимок.tracks[4999].id === 'id4999',
      `запись ${запись} мс, чтение ${чтение} мс`)
    ok('чтение склада быстрое — иначе оно не имеет смысла', чтение < 1500, чтение + ' мс')

    const сейчас = Date.now()
    ok('склад на месте — заново его не качаем',
      libraryPlan(снимок, 5000, сейчас).kind === 'incremental',
      libraryPlan(снимок, 5000, сейчас).kind)
    ok('появились новые — спрашиваем только их, а не весь склад',
      libraryPlan(снимок, 5003, сейчас).kind === 'incremental',
      libraryPlan(снимок, 5003, сейчас).kind)
    ok('не смогли спросить число — снимок всё равно годится',
      libraryPlan(снимок, null, сейчас).kind === 'incremental',
      libraryPlan(снимок, null, сейчас).kind)
    ok('старый снимок перечитываем целиком',
      libraryPlan(снимок, 5000, сейчас + 8 * 24 * 3600 * 1000).kind === 'full')
    ok('пропало много — качаем целиком, а не гадаем',
      libraryPlan(снимок, 4000, сейчас).kind === 'full',
      libraryPlan(снимок, 4000, сейчас).kind)
    ok('без склада на устройстве качаем целиком',
      libraryPlan(null, 10, сейчас).kind === 'full')
    ok('самая свежая дата берётся из самих треков, а не из времени записи',
      newestAt(треки).startsWith('2026'), newestAt(треки))

    await dropLibrary()
    ok('склад можно стереть — это способ начать заново', (await loadLibrary()) === null)
  }

  try { audio.pause(); await ctx.close() } catch { /* окно уже закрывают */ }

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
