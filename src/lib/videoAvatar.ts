// v1.95.0: видео-аватарки и видео-фоны «кубика» профиля.
// Видео ограничены 5 секундами: длинные ролики обрезаются при загрузке
// (captureStream + MediaRecorder -> webm), а при показе таймер в любом случае
// зацикливает первые 5 сек — даже если обрезка была недоступна (старый Safari).
export const AVATAR_VIDEO_MAX_SEC = 5

export const isVideoUrl = (u?: string | null) => !!u && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)

// Обрезает видео до 5 сек. Если видео и так короткое или браузер не умеет
// captureStream/MediaRecorder — возвращает исходный файл как есть.
export async function trimVideoTo5s(file: File): Promise<File> {
  let url = ''
  try {
    url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.src = url; v.muted = true; (v as any).playsInline = true
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('bad video')) })
    if (!isFinite(v.duration) || v.duration <= AVATAR_VIDEO_MAX_SEC + 0.25) return file
    const stream: MediaStream | undefined = (v as any).captureStream?.()
    if (!stream || typeof MediaRecorder === 'undefined') return file
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : ''
    if (!mime) return file
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const stopped = new Promise<void>(res => { rec.onstop = () => res() })
    v.currentTime = 0
    await v.play()
    rec.start(250)
    await new Promise(r => setTimeout(r, AVATAR_VIDEO_MAX_SEC * 1000))
    rec.stop(); v.pause()
    await stopped
    if (chunks.length === 0) return file
    const name = file.name.replace(/\.\w+$/, '') + '_5s.webm'
    return new File([new Blob(chunks, { type: 'video/webm' })], name, { type: 'video/webm' })
  } catch { return file }
  finally { if (url) URL.revokeObjectURL(url) }
}
