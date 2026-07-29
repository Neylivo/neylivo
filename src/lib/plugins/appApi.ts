// v1.419.0: то, что плагин может делать с самим приложением — переход по
// каналам, список серверов, своя активность и звук.
//
// Всё это человек делает сам мышью, и ничего из этого не даёт плагину нового
// доступа: сервера и каналы он и так видит в колонке слева, активность сам
// пишет в настройках, а звук — те же два сигнала, что и у приложения. Здесь
// собрано отдельно от диспетчера, чтобы api.ts оставался таблицей «метод →
// разрешение», а не свалкой обращений к базе и к настройкам.
//
// Всё тяжёлое подгружается в момент вызова, а не при старте. Две причины, и обе
// настоящие: во-первых, API плагинов живёт с первой секунды, и тащить в
// стартовую сборку клиент базы ради метода, которым пользуется один плагин из
// десяти, незачем (см. потолок веса в scripts/smoke.cjs). Во-вторых, проверки
// (npm run test:attack) поднимают диспетчер в голом Node, где никакого
// import.meta.env нет, — статический импорт supabase уронил бы их на первой же
// строке, ещё до первой атаки.

export interface PluginServerInfo { id: string; name: string }
export interface PluginChannelInfo { id: string; name: string; serverId: string; kind: string }

/**
 * Сервера, где ты состоишь. Из базы приходит только то, что и так на экране:
 * id и название. Настройки сервера, его участников и права плагину не отдаём —
 * из них при желании собирается портрет всех, с кем человек общается.
 */
export async function pluginServers(): Promise<PluginServerInfo[]> {
  const { supabase } = await import('../supabase')
  const { data, error } = await supabase.from('servers').select('id, name').order('created_at')
  if (error) throw new Error('Не удалось получить список серверов')
  return ((data ?? []) as any[]).map(s => ({ id: String(s.id), name: String(s.name ?? '') }))
}

/** Каналы одного сервера — те же, что в списке слева. */
export async function pluginChannels(serverId: string): Promise<PluginChannelInfo[]> {
  const { supabase } = await import('../supabase')
  // Порядок — по имени, как в самом списке каналов (ServerView): колонки
  // position у таблицы нет, и запрос по ней вернул бы ошибку.
  const { data, error } = await supabase.from('channels').select('id, name, kind, server_id')
    .eq('server_id', serverId).order('name')
  if (error) throw new Error('Не удалось получить список каналов')
  return ((data ?? []) as any[]).map(c => ({
    id: String(c.id), name: String(c.name ?? ''),
    serverId: String(c.server_id), kind: String(c.kind ?? 'text'),
  }))
}

/**
 * Открыть канал, диалог по его id или личку с человеком.
 *
 * Дорога та же, которой ходят диплинки и быстрый переход (Ctrl+K): плагин не
 * трогает состояние экранов, он лишь просит приложение сделать то, что оно и
 * так умеет. Поэтому и обрабатывается это со всеми проверками — на закрытый
 * канал плагин человека не заведёт.
 */
export function pluginOpen(target: { serverId?: string; channelId?: string; dmId?: string; userId?: string; userName?: string }): boolean {
  if (target.dmId) {
    window.dispatchEvent(new CustomEvent('ponoi-open-dm-thread', { detail: { threadId: target.dmId } }))
    return true
  }
  if (target.userId) {
    window.dispatchEvent(new CustomEvent('ponoi-open-dm', { detail: { id: target.userId, name: target.userName || 'Пользователь' } }))
    return true
  }
  if (target.serverId) {
    window.dispatchEvent(new CustomEvent('ponoi-open-server', {
      detail: { id: target.serverId, channelId: target.channelId || undefined },
    }))
    return true
  }
  return false
}

/**
 * Своя активность — та самая строка «Настройки → Активность», которую видят
 * рядом с твоим ником.
 *
 * Пишем ЧЕРЕЗ настройки, а не мимо них: иначе на экране настроек осталась бы
 * старая строка, а людям показывалась бы новая — то самое расхождение показа с
 * действием, от которого в этом проекте больше всего бед. Событие
 * ponoi-settings-external говорит открытому экрану настроек перечитать себя,
 * ponoi-activity — presence разослать новое состояние.
 */
export async function pluginSetStatus(text: string): Promise<string> {
  const { loadSettings, saveSettings } = await import('../settingsStore')
  const clean = text.trim().slice(0, 128)
  const s = loadSettings()
  saveSettings({ ...s, actOn: clean.length > 0, actText: clean })
  window.dispatchEvent(new Event('ponoi-settings-external'))
  window.dispatchEvent(new Event('ponoi-activity'))
  return clean
}

export async function pluginGetStatus(): Promise<string> {
  const { loadSettings } = await import('../settingsStore')
  const s = loadSettings()
  return s.actOn ? String(s.actText ?? '') : ''
}

/**
 * Звуки. Список закрытый и короткий: это те же два сигнала, которыми
 * приложение отвечает на сообщение и на удачное действие. Своего звука плагину
 * не дать — иначе он подкладывал бы в приложение что угодно, вплоть до записи
 * чужого голоса.
 */
export const PLUGIN_SOUND_NAMES = ['message', 'chime'] as const

export async function pluginPlaySound(name: string): Promise<void> {
  const { msgSound, uiChime } = await import('../notify')
  if (name === 'message') msgSound()
  else uiChime()
}
