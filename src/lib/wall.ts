// «Стена росписи» (v1.146.0): общий холст на профиле пользователя. Любой участник
// может добавить рисунок; рисунки видны всем и обновляются в реальном времени.
// Удаление разрешено автору рисунка или владельцу стены (RLS, миграция 30).
import { supabase } from './supabase'
import { uploadTo } from './storage'

export interface Drawing {
  id: string
  wall_user_id: string
  author_id: string
  author_name: string | null
  image_url: string
  created_at: string
}

export async function fetchWall(wallUserId: string): Promise<Drawing[]> {
  const { data } = await supabase.from('wall_drawings')
    .select('*').eq('wall_user_id', wallUserId).order('created_at', { ascending: false })
  return (data as Drawing[]) ?? []
}

export async function addDrawing(wallUserId: string, authorId: string, authorName: string, blob: Blob): Promise<void> {
  const file = new File([blob], `wall_${Date.now()}.png`, { type: 'image/png' })
  const url = await uploadTo('avatars', authorId, file)
  const { error } = await supabase.from('wall_drawings').insert({
    wall_user_id: wallUserId, author_id: authorId, author_name: authorName, image_url: url,
  })
  if (error) throw error
}

// Путь объекта в бакете avatars — всё после "/avatars/" в публичном URL.
function storagePathOf(imageUrl: string): string | null {
  const m = imageUrl.match(/\/avatars\/(.+)$/)
  return m ? m[1] : null
}

export async function deleteDrawing(d: Drawing): Promise<void> {
  const { error } = await supabase.from('wall_drawings').delete().eq('id', d.id)
  if (error) throw error
  const path = storagePathOf(d.image_url)
  if (path) supabase.storage.from('avatars').remove([path]).catch(() => {})
}

// Realtime: любые изменения стены этого пользователя дёргают колбэк (перезагрузка списка).
export function subscribeWall(wallUserId: string, cb: () => void): () => void {
  const ch = supabase.channel('wall:' + wallUserId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'wall_drawings', filter: 'wall_user_id=eq.' + wallUserId },
      () => cb())
    .subscribe()
  return () => { supabase.removeChannel(ch) }
}
