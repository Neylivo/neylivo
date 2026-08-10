// v1.536.0: работа с доверенными устройствами и кодом восстановления.
//
// Правила — в src/lib/deviceGuard.ts, разметка — в DevicesPanel.tsx, а здесь
// разговор с базой. Разделено так же, как везде в этом проекте: правило можно
// проверить числами, разметку — глазами, а сеть нельзя ни тем, ни другим, и
// смешивать их значит не проверить ничего.
//
// Устройство узнаётся по тому же номеру, что и ключи шифрования (deviceId из
// crypto/keys.ts). Заводить второй номер было бы ошибкой: тогда «устройство» в
// списке безопасности и «устройство» в шифровании — разные вещи, и человек,
// отозвав одно, не отозвал бы другое.
import { supabase } from './supabase'
import { deviceId } from './crypto/keys'
import { deviceLabel, codeFingerprint, newRecoveryCode, type DeviceRecord } from './deviceGuard'

export interface DeviceRow extends DeviceRecord {
  label: string
  lastSeen: number
  /** Это то устройство, за которым сидят прямо сейчас. */
  me: boolean
}

/**
 * Отметиться: «я здесь». Зовётся при запуске.
 *
 * Первая отметка и создаёт запись — с этого мига считаются сутки замка для
 * нового устройства. Отдельного «запомнить устройство» нет намеренно: человек
 * не должен ничего нажимать, чтобы защита работала.
 */
export async function touchDevice(meId: string): Promise<void> {
  const id = deviceId()
  const сейчас = new Date().toISOString()
  // upsert без onConflict обновил бы всё подряд; нам нужно не трогать first_seen
  // и trusted — иначе каждый запуск делал бы устройство «новым» заново.
  const { error } = await supabase.from('trusted_devices')
    .upsert({ user_id: meId, device_id: id, label: deviceLabel(navigator.userAgent), last_seen: сейчас },
      { onConflict: 'user_id,device_id', ignoreDuplicates: false })
  if (error) throw error
}

export async function listDevices(meId: string): Promise<DeviceRow[]> {
  const { data, error } = await supabase.from('trusted_devices')
    .select('device_id, label, first_seen, last_seen, trusted')
    .eq('user_id', meId).order('last_seen', { ascending: false })
  if (error) throw error
  const мой = deviceId()
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.device_id),
    label: String(r.label || 'устройство'),
    firstSeen: new Date(String(r.first_seen)).getTime(),
    lastSeen: new Date(String(r.last_seen)).getTime(),
    trusted: !!r.trusted,
    me: String(r.device_id) === мой,
  }))
}

/** «Это я» — снимает замок с устройства немедленно. */
export async function trustDevice(meId: string, id: string): Promise<void> {
  const { error } = await supabase.from('trusted_devices')
    .update({ trusted: true }).eq('user_id', meId).eq('device_id', id)
  if (error) throw error
}

/** Забыть устройство: следующий вход с него снова будет новым. */
export async function forgetDevice(meId: string, id: string): Promise<void> {
  const { error } = await supabase.from('trusted_devices')
    .delete().eq('user_id', meId).eq('device_id', id)
  if (error) throw error
}

/**
 * Экстренная заморозка: выйти отовсюду.
 *
 * Это и есть «красная кнопка» из письма Steam. Работает всегда и без задержек —
 * в отличие от опасных действий, которым задержка нужна, это действие человека
 * ЗАЩИЩАЕТ.
 *
 * Своё устройство тоже выходит: оставлять его в сети значит верить, что за ним
 * сидит владелец, а нажимают эту кнопку как раз тогда, когда не уверены.
 */
export async function freezeEverywhere(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  if (error) throw error
}

/**
 * Выпустить новый код восстановления.
 *
 * Возвращает сам код — его нужно показать человеку ОДИН раз и попросить
 * записать. На сервер уходит только отпечаток: восстановить код из него нельзя,
 * а значит и потерять его на сервере невозможно.
 */
export async function issueRecoveryCode(meId: string): Promise<string> {
  const код = newRecoveryCode()
  const fp = await codeFingerprint(код)
  const { error } = await supabase.from('recovery_codes')
    .upsert({ user_id: meId, fingerprint: fp, created_at: new Date().toISOString(), used_at: null },
      { onConflict: 'user_id' })
  if (error) throw error
  return код
}

/** Проверить введённый код. Сравнение идёт на сервере, отпечатками. */
export async function checkRecoveryCode(input: string): Promise<boolean> {
  const fp = await codeFingerprint(input)
  const { data, error } = await supabase.rpc('check_recovery_code', { fp })
  if (error) throw error
  return data === true
}
