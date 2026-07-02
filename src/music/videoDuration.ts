// Reads a video file's duration (seconds) via a metadata probe.
export function videoDuration(file: File): Promise<number> {
  return new Promise((res, rej) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(v.duration) }
    v.onerror = () => { URL.revokeObjectURL(v.src); rej(new Error('Не удалось прочитать видео')) }
    v.src = URL.createObjectURL(file)
  })
}
