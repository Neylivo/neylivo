import { supabase } from './supabase'

// Uploads a file into <bucket>/<uid>/<timestamp>_<name> and returns its public URL.
export async function uploadTo(bucket: string, uid: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${uid}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600', upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export const isImage = (f: File | string) =>
  typeof f === 'string' ? /\.(png|jpe?g|gif|webp|svg)$/i.test(f) : f.type.startsWith('image/')


// Загрузка с прогрессом: XMLHttpRequest даёт события progress, которых нет в supabase-js.
// Заголовки и путь те же, что использует supabase.storage.upload, поэтому политики бакета работают как раньше.
export async function uploadWithProgress(bucket: string, uid: string, file: File, onProgress?: (p: number) => void): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${uid}/${Date.now()}_${safe}`
  const base = import.meta.env.VITE_SUPABASE_URL as string
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token ?? anon
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.setRequestHeader('apikey', anon)
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total) }
    xhr.onload = () => { if (xhr.status < 300) resolve(); else reject(new Error('Загрузка не удалась (' + xhr.status + ')')) }
    xhr.onerror = () => reject(new Error('Сбой сети при загрузке файла'))
    xhr.send(file)
  })
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
