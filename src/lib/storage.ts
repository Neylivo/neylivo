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
