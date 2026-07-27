import { useEffect, useState } from 'react'
import type { FnRef } from './sandbox'

// v1.286.0: реестр того, что плагины добавили в интерфейс. Плагин не рисует ничего
// сам (он в воркере и до DOM не дотягивается) — он ЗАЯВЛЯЕТ, что хочет кнопку с
// такой-то иконкой и подписью, а рисует её приложение обычными своими компонентами.
// Поэтому плагин не может подделать чужой элемент интерфейса или нарисовать поверх
// экрана фальшивое окно ввода пароля.
//
// Подписка — тем же приёмом, что в netStatus.ts: Set слушателей + хук на useState.

/** Иконки, доступные плагинам. Список закрытый: имена иконок — внутренняя деталь
 *  (см. icons.tsx, там default возвращает null), и неизвестное имя нарисовало бы
 *  пустоту вместо кнопки. */
export const PLUGIN_ICONS = [
  'zap', 'star', 'flame', 'paw', 'cube', 'ball', 'skull', 'sword', 'rifle', 'car',
  'compass', 'flag', 'tag', 'pin', 'link', 'code', 'list', 'search', 'image', 'camera',
  'film', 'music', 'volume', 'bell', 'mail', 'lock', 'shield', 'crown', 'gamepad',
  'message', 'smile', 'paperclip', 'clock', 'folder', 'copy', 'edit', 'trash', 'rotate',
] as const
const DEFAULT_ICON = 'zap'
export function safeIcon(name: unknown): string {
  return (PLUGIN_ICONS as readonly string[]).includes(String(name)) ? String(name) : DEFAULT_ICON
}

export interface ComposerButton { pluginId: string; key: string; icon: string; tooltip: string; onClick: FnRef }
export interface MessageAction { pluginId: string; key: string; icon: string; label: string; onClick: FnRef }
export interface SlashCommand { pluginId: string; name: string; description: string; handler: FnRef }
export interface PluginSettingsPage { pluginId: string; title: string; rows: SettingsRow[] }

/** Строка на странице настроек плагина. Плагин описывает её данными, а не разметкой. */
export type SettingsRow =
  | { type: 'toggle'; key: string; label: string; description?: string; value: boolean }
  | { type: 'text'; key: string; label: string; description?: string; value: string; placeholder?: string }
  | { type: 'select'; key: string; label: string; description?: string; value: string; options: { value: string; label: string }[] }
  | { type: 'button'; key: string; label: string; description?: string; onClick: FnRef }

interface Registry {
  composerButtons: ComposerButton[]
  messageActions: MessageAction[]
  commands: SlashCommand[]
  settingsPages: PluginSettingsPage[]
}
const reg: Registry = { composerButtons: [], messageActions: [], commands: [], settingsPages: [] }

const listeners = new Set<() => void>()
function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }
function useReg<T>(pick: () => T): T {
  const [v, setV] = useState(pick)
  useEffect(() => {
    const fn = () => setV(pick())
    listeners.add(fn)
    fn()   // состояние могло измениться между первым рендером и подпиской
    return () => { listeners.delete(fn) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return v
}

// ---- CSS плагинов -------------------------------------------------------------
// Каждому плагину — свой <style data-plugin>, чтобы выключение снимало ровно его
// стили и ничего чужого.
const styleEls = new Map<string, HTMLStyleElement>()

export function setPluginCss(pluginId: string, css: string) {
  let el = styleEls.get(pluginId)
  if (!el) {
    el = document.createElement('style')
    el.dataset.plugin = pluginId
    document.head.appendChild(el)
    styleEls.set(pluginId, el)
  }
  el.textContent = css
}

// ---- Регистрация вкладов ------------------------------------------------------
export function addComposerButton(b: ComposerButton) {
  reg.composerButtons = [...reg.composerButtons.filter(x => x.key !== b.key || x.pluginId !== b.pluginId), b]
  notify()
}
export function addMessageAction(a: MessageAction) {
  reg.messageActions = [...reg.messageActions.filter(x => x.key !== a.key || x.pluginId !== a.pluginId), a]
  notify()
}
export function addCommand(c: SlashCommand) {
  reg.commands = [...reg.commands.filter(x => x.name !== c.name || x.pluginId !== c.pluginId), c]
  notify()
}
export function setSettingsPage(p: PluginSettingsPage) {
  reg.settingsPages = [...reg.settingsPages.filter(x => x.pluginId !== p.pluginId), p]
  notify()
}

/** Снять всё, что зарегистрировал плагин, — при выключении и при удалении. */
export function clearPlugin(pluginId: string) {
  reg.composerButtons = reg.composerButtons.filter(x => x.pluginId !== pluginId)
  reg.messageActions = reg.messageActions.filter(x => x.pluginId !== pluginId)
  reg.commands = reg.commands.filter(x => x.pluginId !== pluginId)
  reg.settingsPages = reg.settingsPages.filter(x => x.pluginId !== pluginId)
  const el = styleEls.get(pluginId)
  if (el) { el.remove(); styleEls.delete(pluginId) }
  notify()
}

/** Занято ли имя команды другим плагином — команды глобальны, дубли надо ловить. */
export function commandOwner(name: string): string | null {
  return reg.commands.find(c => c.name === name)?.pluginId ?? null
}

// ---- Чтение из интерфейса ------------------------------------------------------
export const getCommands = () => reg.commands
export const getSettingsPages = () => reg.settingsPages
export const useComposerButtons = () => useReg(() => reg.composerButtons)
export const useMessageActions = () => useReg(() => reg.messageActions)
export const useSlashCommands = () => useReg(() => reg.commands)
export const useSettingsPages = () => useReg(() => reg.settingsPages)
