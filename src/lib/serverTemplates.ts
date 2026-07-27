import { supabase } from './supabase'
import type { Channel } from '../types'
import type { ServerRole } from './roles'

// v1.318.0: шаблоны серверов — снимок устройства сервера и код, по которому любой
// может собрать себе такой же.
//
// Что копируется: каналы (название, тип, тема, настройки) и роли (название, цвет,
// права, порядок). Что НЕ копируется: сообщения, участники, картинки и приватность
// каналов. Приватность завязана на конкретные роли ЧУЖОГО сервера, и перенос её
// вслепую открыл бы у нового владельца то, что он открывать не собирался.

export interface ServerTemplate {
  code: string
  name: string
  description: string | null
  uses: number
  created_at: string
  snapshot: TemplateSnapshot
}

export interface TemplateSnapshot {
  channels: { name: string; kind?: string | null; topic?: string | null; settings?: any }[]
  roles: { name: string; color: string; position: number; permissions: number }[]
}

/** Короткий код из символов, которые не путаются при переписывании от руки:
 *  без нуля и буквы O, без единицы и I. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function buildSnapshot(channels: Channel[], roles: ServerRole[]): TemplateSnapshot {
  return {
    channels: channels.map(c => ({
      name: c.name,
      kind: (c as any).kind ?? null,
      topic: (c as any).topic ?? null,
      // Приватность намеренно вырезается: она ссылается на роли исходного сервера,
      // которых на новом нет, и перенос оставил бы канал закрытым для всех.
      settings: stripPrivate((c as any).settings),
    })),
    roles: roles.map(r => ({
      name: r.name, color: r.color, position: r.position, permissions: r.permissions ?? 0,
    })),
  }
}

function stripPrivate(settings: any): any {
  if (!settings || typeof settings !== 'object') return {}
  const { private: _p, ...rest } = settings
  return rest
}

/** Создать (или пересоздать) шаблон сервера. Возвращает код. */
export async function createTemplate(
  serverId: string, name: string, description: string,
  channels: Channel[], roles: ServerRole[],
): Promise<string> {
  const { data: me } = await supabase.auth.getUser()
  const uid = me.user?.id
  if (!uid) throw new Error('Нужно войти в аккаунт')
  const code = makeCode()
  const { error } = await supabase.from('server_templates').insert({
    code, server_id: serverId, author: uid,
    name: name.trim() || 'Шаблон сервера',
    description: description.trim() || null,
    snapshot: buildSnapshot(channels, roles),
  })
  if (error) throw new Error(templateErr(error.message))
  return code
}

export async function myTemplateFor(serverId: string): Promise<ServerTemplate | null> {
  const { data, error } = await supabase.from('server_templates')
    .select('code, name, description, uses, created_at, snapshot')
    .eq('server_id', serverId).order('created_at', { ascending: false }).limit(1)
  if (error) return null
  return (data?.[0] as ServerTemplate) ?? null
}

export async function deleteTemplate(code: string): Promise<void> {
  const { error } = await supabase.from('server_templates').delete().eq('code', code)
  if (error) throw new Error(templateErr(error.message))
}

/** Посмотреть чужой шаблон до применения — чтобы человек видел, что получит. */
export async function fetchTemplate(code: string): Promise<ServerTemplate | null> {
  const { data, error } = await supabase.from('server_templates')
    .select('code, name, description, uses, created_at, snapshot')
    .eq('code', code.trim().toUpperCase()).limit(1)
  if (error) throw new Error(templateErr(error.message))
  return (data?.[0] as ServerTemplate) ?? null
}

/** Создать сервер по шаблону. Возвращает id нового сервера. */
export async function applyTemplate(code: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc('apply_template', {
    p_code: code.trim().toUpperCase(), p_name: name.trim(),
  })
  if (error) throw new Error(templateErr(error.message))
  if (!data) throw new Error('Не удалось создать сервер по шаблону')
  return data as string
}

function templateErr(msg: string): string {
  // Самая частая причина у того, кто ведёт этот проект, — не применённая миграция.
  // Общее «relation does not exist» ему ничего не скажет, а это — скажет.
  if (/server_templates|apply_template|does not exist/i.test(msg)) {
    return 'Шаблоны пока не включены — примени миграцию supabase/79_server_templates.sql'
  }
  return msg
}
