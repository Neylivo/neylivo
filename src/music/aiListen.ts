// v1.420.0: живая половина внутреннего ИИ — скачать модель и послушать трек.
//
// Отдельным файлом от aiLyrics.ts не для красоты: там чистые функции, которые
// проверяются в обычном Node (npm run test:lyrics), а здесь — библиотека
// распознавания, которая тянет за собой onnxruntime с двоичными файлами под
// каждую платформу. Стоило им оказаться в одном файле, и сборка проверки
// падала на них, не дойдя ни до одной проверки.
//
// Всё тяжёлое грузится ТОЛЬКО по нажатию: библиотека — отдельным куском сборки,
// модель — из сети при первом запуске (дальше её держит кэш браузера). В
// стартовую сборку приложения отсюда не попадает ничего.
import { AI_MODEL, type SpeechChunk, type AiProgress } from './aiLyrics'

// ── Живая часть: скачать модель, послушать трек ────────────────────────────
//
// Всё тяжёлое здесь и грузится ТОЛЬКО по нажатию: библиотека распознавания —
// отдельным куском сборки, модель — с сети при первом запуске (дальше её держит
// кэш браузера). Поэтому в стартовую сборку приложения из этого файла не
// попадает ничего, кроме чистых функций выше.

/** Звук трека — в моно 16 кГц, как ждёт модель. */
export async function decodeMono16k(buf: ArrayBuffer): Promise<Float32Array> {
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const tmp = new AC()
  try {
    const decoded = await tmp.decodeAudioData(buf.slice(0))
    const rate = 16000
    const frames = Math.ceil(decoded.duration * rate)
    const off = new OfflineAudioContext(1, frames, rate)
    const srcNode = off.createBufferSource()
    srcNode.buffer = decoded
    srcNode.connect(off.destination)
    srcNode.start()
    const out = await off.startRendering()
    return out.getChannelData(0)
  } finally {
    try { await tmp.close() } catch { /* уже закрыт */ }
  }
}

/**
 * Послушать трек и вернуть распознанные куски.
 *
 * Библиотека и модель подгружаются здесь же, при первом вызове. Ошибку не
 * глотаем: человек нажал кнопку и должен узнать, что именно не получилось —
 * нет сети, не дали скачать модель, звук не отдался по этой ссылке.
 */
export async function listenToTrack(src: string, onProgress: (p: AiProgress) => void): Promise<SpeechChunk[]> {
  onProgress({ stage: 'audio', percent: 5, note: 'Забираю звук трека' })
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Звук не отдался (${res.status}). Бывает у ссылок, которые не разрешают читать себя из приложения.`)
  const buf = await res.arrayBuffer()

  onProgress({ stage: 'audio', percent: 20, note: 'Готовлю звук' })
  const pcm = await decodeMono16k(buf)

  onProgress({ stage: 'model', percent: 25, note: 'Загружаю модель распознавания' })
  const { pipeline, env } = await import('@xenova/transformers')
  // Локальных файлов модели у нас нет — берём из сети и кэшируем браузером.
  env.allowLocalModels = false
  const asr = await pipeline('automatic-speech-recognition', AI_MODEL, {
    progress_callback: (p: any) => {
      if (p?.status === 'progress' && typeof p.progress === 'number') {
        onProgress({ stage: 'model', percent: 25 + Math.round(p.progress * 0.35), note: 'Загружаю модель распознавания' })
      }
    },
  })

  onProgress({ stage: 'listen', percent: 62, note: 'Слушаю трек' })
  const out: any = await asr(pcm, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  })

  const chunks: SpeechChunk[] = (out?.chunks ?? []).map((c: any) => ({
    start: Number(c?.timestamp?.[0] ?? 0),
    end: c?.timestamp?.[1] === null || c?.timestamp?.[1] === undefined ? null : Number(c.timestamp[1]),
    text: String(c?.text ?? '').trim(),
  }))
  onProgress({ stage: 'listen', percent: 100, note: 'Готово' })
  return chunks
}
