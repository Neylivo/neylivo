// v1.436.0: настройки демонстрации экрана — отдельно и проверяемо.
//
// Зачем. Раньше это была одна длинная строка прямо в обработчике кнопки: три
// объекта настроек вперемешку, и понять по ней, что именно уедет собеседнику,
// было нельзя. А ошибиться тут легко и незаметно: перепутанные ширина с высотой
// или битрейт «на глазок» дают мыло, которое видно только на той стороне.
//
// Здесь — чистые функции: что показываем, с каким качеством и со звуком ли.

export interface ShareRes { label: string; w: number; h: number; br: number }

/**
 * Ступени качества — как «Качество стрима» в Discord.
 *
 * Битрейты не выдуманы: это то, что нужно потоку такого размера, чтобы на
 * движущейся картинке не рассыпаться в квадраты. Ниже 720p ступени нет
 * намеренно: смотреть демку в 480p всё равно нельзя, а место в меню она занимает.
 */
export const SHARE_RES: ShareRes[] = [
  { label: '720p', w: 1280, h: 720, br: 4_000_000 },
  { label: '1080p', w: 1920, h: 1080, br: 10_000_000 },
  { label: '1440p', w: 2560, h: 1440, br: 20_000_000 },
  { label: '4K', w: 3840, h: 2160, br: 40_000_000 },
]
export const SHARE_FPS = [15, 30, 60]

export interface ShareQuality { res: string; fps: number; audio: boolean; sourceId?: string | null }

export const DEFAULT_SHARE: ShareQuality = { res: '1080p', fps: 60, audio: true, sourceId: null }

/** Разобрать сохранённые настройки, не веря им на слово. */
export function readShareQuality(raw: string | null): ShareQuality {
  try {
    const s = JSON.parse(raw || '{}')
    const res = SHARE_RES.some(r => r.label === s.res) ? s.res : DEFAULT_SHARE.res
    const fps = SHARE_FPS.includes(s.fps) ? s.fps : DEFAULT_SHARE.fps
    return { res, fps, audio: s.audio !== false, sourceId: typeof s.sourceId === 'string' ? s.sourceId : null }
  } catch { return { ...DEFAULT_SHARE } }
}

export const resOf = (label: string): ShareRes => SHARE_RES.find(r => r.label === label) ?? SHARE_RES[1]

/**
 * Что просим у браузера и что говорим о дорожке.
 *
 * `contentHint` — чему отдать предпочтение при нехватке места: на 60 кадрах это
 * плавность (игра, видео), на 30 и ниже — чёткость (код, документ, карта).
 * `degradationPreference: maintain-resolution` — запрет ронять разрешение под
 * нагрузкой: лучше потерять кадры, чем показывать мыло, ради которого 4K и
 * включали.
 *
 * Звук просим в чистом стерео и без «улучшайзеров»: эхоподавление и
 * автогромкость сделаны для голоса и превращают музыку в игре в глухое бульканье.
 */
export function shareCapture(q: ShareQuality) {
  const r = resOf(q.res)
  return {
    audio: q.audio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
      : false,
    systemAudio: q.audio ? 'include' : 'exclude',
    resolution: { width: r.w, height: r.h, frameRate: q.fps },
    contentHint: q.fps >= 60 ? 'motion' : 'detail',
  }
}

export function sharePublish(q: ShareQuality) {
  const r = resOf(q.res)
  return {
    screenShareEncoding: { maxBitrate: r.br, maxFramerate: q.fps, priority: 'high' as const },
    degradationPreference: 'maintain-resolution' as const,
    simulcast: false,
    audioPreset: q.audio ? { maxBitrate: 128_000 } : undefined,
  }
}

/** Человеческая подпись под кнопкой: «1080p · 60 к/с · со звуком». */
export function shareSummary(q: ShareQuality): string {
  return `${q.res} · ${q.fps} к/с · ${q.audio ? 'со звуком' : 'без звука'}`
}

export interface ShareSource { id: string; name: string; kind: 'screen' | 'window'; thumb?: string | null; icon?: string | null }

/**
 * Порядок источников в списке: сначала экраны, потом окна по алфавиту.
 *
 * Своё же окно Ponoi из списка убираем: показывать демонстрацию внутри
 * демонстрации — это бесконечный коридор, и человек выбирает его по ошибке
 * чаще, чем можно подумать.
 */
export function orderSources(list: ShareSource[], selfTitleRe = /ponoi/i): ShareSource[] {
  const clean = (list ?? []).filter(s => s && s.id && !(s.kind === 'window' && selfTitleRe.test(s.name || '')))
  const screens = clean.filter(s => s.kind === 'screen')
  const windows = clean.filter(s => s.kind === 'window')
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'))
  return [...screens, ...windows]
}
