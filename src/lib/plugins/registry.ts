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

/**
 * Строка на странице настроек плагина и в его панели. Плагин описывает её
 * ДАННЫМИ, а не разметкой: рисует всё приложение своими компонентами.
 *
 * v1.419.0: строк стало вдвое больше. Раньше их было четыре — переключатель,
 * поле, выбор и кнопка, — и это значило, что плагин мог сделать только
 * настройку. Показать что-нибудь (погоду, счёт, время до конца трека) ему было
 * нечем: единственным способом сказать хоть слово оставалось всплывающее
 * уведомление. Отсюда и берётся ощущение, что плагины «почти ничего не могут».
 *
 * Ни одна новая строка не даёт плагину разметки: он присылает число, цвет или
 * ссылку на картинку, а как это выглядит — решает приложение.
 */
export type SettingsRow =
  | { type: 'toggle'; key: string; label: string; description?: string; value: boolean }
  | { type: 'text'; key: string; label: string; description?: string; value: string; placeholder?: string }
  | { type: 'select'; key: string; label: string; description?: string; value: string; options: { value: string; label: string }[] }
  | { type: 'button'; key: string; label: string; description?: string; onClick: FnRef }
  /** Просто текст: слева подпись, справа значение. Плагин обновляет его, прислав панель заново. */
  | { type: 'label'; key: string; label: string; description?: string; value: string }
  /** Полоса заполнения, 0–100. Для «сколько осталось», «сколько сделано». */
  | { type: 'progress'; key: string; label: string; description?: string; value: number }
  /** Ползунок с числом: min/max/step задаёт плагин, значение хранится у него же. */
  | { type: 'slider'; key: string; label: string; description?: string; value: number; min: number; max: number; step: number }
  /** Выбор цвета — #rrggbb. */
  | { type: 'color'; key: string; label: string; description?: string; value: string }
  /** Картинка по https-ссылке. Рисуется в рамке фиксированного размера. */
  | { type: 'image'; key: string; label: string; description?: string; value: string }

/**
 * Куда плагин может поставить свою панель (v1.417.0).
 *
 * Раньше плагину были доступны ровно три места: кнопка у поля ввода, пункт в
 * меню сообщения и своя страница в настройках. Всё остальное приложение для
 * него не существовало — ни плеер, ни Трекотека, ни колонка со списком.
 *
 * Список мест намеренно закрытый. «Рисуй где хочешь» означало бы отдать
 * плагину саму страницу, а этого нельзя: он выполняется в песочнице ровно для
 * того, чтобы его код никогда не оказался в окне приложения. Поэтому плагин
 * ОПИСЫВАЕТ панель теми же строками, что и страницу настроек, а рисует её
 * приложение своими руками — подделать чужое окно такой панелью невозможно.
 */
export type PanelSlot = 'player' | 'library' | 'sidebar' | 'chat'

export const PANEL_SLOTS: Record<PanelSlot, string> = {
  player: 'Плеер — под обложкой',
  library: 'Трекотека — над списком треков',
  sidebar: 'Колонка слева — под списком каналов',
  // v1.419.0: самое нужное место и самое очевидное — то, на что человек смотрит
  // всё время. Без него панели годились только для музыки, то есть для того,
  // где человек бывает изредка.
  chat: 'Чат — над полем ввода',
}

export interface PluginPanel { pluginId: string; slot: PanelSlot; title: string; rows: SettingsRow[] }

/**
 * Горячая клавиша плагина (v1.419.0).
 *
 * Зачем. Плагин мог получить управление тремя способами: команда в чате, кнопка
 * у поля ввода и пункт меню сообщения — то есть только там, где человек и так
 * что-то печатает. Всё, что хочется вызвать «прямо сейчас, откуда угодно»
 * (спрятать окно, отметить время, переключить трек), плагину было недоступно.
 *
 * Сочетание обязано содержать Ctrl или Alt вместе ещё с одним модификатором
 * (см. okCombo): голые буквы и одиночный Ctrl+K забрали бы у человека набор
 * текста и поиск приложения, причём молча — он не понял бы, какой из плагинов
 * съел его клавишу.
 */
export interface PluginHotkey { pluginId: string; combo: string; description: string; onPress: FnRef }

interface Registry {
  composerButtons: ComposerButton[]
  messageActions: MessageAction[]
  commands: SlashCommand[]
  settingsPages: PluginSettingsPage[]
  panels: PluginPanel[]
  hotkeys: PluginHotkey[]
}
const reg: Registry = { composerButtons: [], messageActions: [], commands: [], settingsPages: [], panels: [], hotkeys: [] }

/**
 * Сколько всего один плагин может добавить (v1.345.0).
 *
 * Раньше потолка не было вовсе: плагин мог зарегистрировать десять тысяч кнопок
 * и превратить поле ввода в кашу, а приложение — в тормозящее нечто. Причём для
 * этого не нужен злой умысел, хватит цикла с ошибкой. Числа взяты с запасом:
 * ни один осмысленный плагин столько не просит.
 */
const MAX_PER_PLUGIN = { buttons: 5, actions: 5, commands: 15, hotkeys: 5 }

/** Снимок для проверок — приложению он не нужен, оно читает через хуки. */
export const getRegistry = (): Registry => reg

// ---- Аварийный режим ----------------------------------------------------------
// Плагин с разрешением css может закрыть приложение непрозрачным слоем или
// спрятать всё подряд — тогда человек не доберётся даже до настроек, чтобы его
// выключить. Значит нужен способ выключить ВСЕ плагины, не нажимая ничего внутри
// приложения: он и есть здесь. Включается горячими клавишами и адресом ?safe=1,
// переживает перезагрузку.
const SAFE_KEY = 'ponoi_plugins_off'
let disabled = (() => { try { return localStorage.getItem(SAFE_KEY) === '1' } catch { return false } })()

export const pluginsDisabled = (): boolean => disabled

export function setPluginsDisabled(on: boolean) {
  disabled = on
  try { on ? localStorage.setItem(SAFE_KEY, '1') : localStorage.removeItem(SAFE_KEY) } catch {}
  if (on) {
    // Снимаем всё сразу: и стили, и кнопки, и команды — не дожидаясь, пока
    // плагины остановятся сами.
    for (const [, el] of styleEls) el.textContent = ''
    // v1.419.0: панели и горячие клавиши тоже. Панели тут не снимались с самого
    // их появления — аварийный режим гасил стили, кнопки и команды, а уголок
    // плагина в чате и в плеере оставался на экране, будто ничего не выключали.
    reg.composerButtons = []; reg.messageActions = []; reg.commands = []; reg.settingsPages = []
    reg.panels = []; reg.hotkeys = []
  }
  notify()
}

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
  if (disabled) return
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
/** Ошибка «плагин просит слишком много» — текст уходит прямо ему. */
export class PluginLimit extends Error {}

function guard(kind: keyof typeof MAX_PER_PLUGIN, list: { pluginId: string }[], pluginId: string, replacing: boolean) {
  if (disabled) throw new PluginLimit('Плагины выключены аварийным режимом')
  if (replacing) return
  const mine = list.filter(x => x.pluginId === pluginId).length
  const max = MAX_PER_PLUGIN[kind]
  if (mine >= max) {
    const what = kind === 'buttons' ? 'кнопок'
      : kind === 'actions' ? 'действий над сообщением'
      : kind === 'hotkeys' ? 'горячих клавиш' : 'команд'
    throw new PluginLimit(`Плагин просит слишком много ${what}: больше ${max} нельзя.`)
  }
}

export function addComposerButton(b: ComposerButton) {
  guard('buttons', reg.composerButtons, b.pluginId, reg.composerButtons.some(x => x.key === b.key && x.pluginId === b.pluginId))
  reg.composerButtons = [...reg.composerButtons.filter(x => x.key !== b.key || x.pluginId !== b.pluginId), b]
  notify()
}
export function addMessageAction(a: MessageAction) {
  guard('actions', reg.messageActions, a.pluginId, reg.messageActions.some(x => x.key === a.key && x.pluginId === a.pluginId))
  reg.messageActions = [...reg.messageActions.filter(x => x.key !== a.key || x.pluginId !== a.pluginId), a]
  notify()
}
export function addCommand(c: SlashCommand) {
  guard('commands', reg.commands, c.pluginId, reg.commands.some(x => x.name === c.name && x.pluginId === c.pluginId))
  reg.commands = [...reg.commands.filter(x => x.name !== c.name || x.pluginId !== c.pluginId), c]
  notify()
}
/**
 * Панель плагина в одном из мест приложения. Одна панель на место на плагин:
 * иначе один плагин застроит собой весь угол.
 */
export function setPanel(p: PluginPanel) {
  if (disabled) throw new PluginLimit('Плагины выключены аварийным режимом')
  const others = reg.panels.filter(x => !(x.pluginId === p.pluginId && x.slot === p.slot))
  // Панелей в одном месте от всех плагинов — не больше трёх: дальше это уже не
  // «свой уголок», а свалка поверх приложения.
  if (others.filter(x => x.slot === p.slot).length >= 3) {
    throw new PluginLimit('В этом месте уже три панели от плагинов')
  }
  reg.panels = [...others, p]
  notify()
}

/**
 * Проверка сочетания клавиш (v1.419.0).
 *
 * Требуем Ctrl или Alt И ещё один модификатор сверх него. Иначе плагин забрал
 * бы у человека либо саму букву, либо привычное сочетание приложения (Ctrl+K —
 * переход, Ctrl+F — поиск), и виновника он бы не нашёл: клавиша просто
 * перестала бы работать.
 */
export function okCombo(combo: string): boolean {
  const parts = combo.split('+').map(s => s.trim()).filter(Boolean)
  const mods = parts.filter(p => ['Ctrl', 'Meta', 'Alt', 'Shift'].includes(p))
  const keys = parts.filter(p => !['Ctrl', 'Meta', 'Alt', 'Shift'].includes(p))
  if (keys.length !== 1) return false
  if (mods.length < 2) return false
  return mods.includes('Ctrl') || mods.includes('Alt') || mods.includes('Meta')
}

export function addHotkey(h: PluginHotkey) {
  guard('hotkeys', reg.hotkeys, h.pluginId, reg.hotkeys.some(x => x.combo === h.combo && x.pluginId === h.pluginId))
  // Занятое другим плагином сочетание — ошибка, а не тихая подмена: иначе
  // второй плагин молча отнял бы клавишу у первого, и оба выглядели бы
  // сломанными. Ровно как с именами команд.
  const owner = reg.hotkeys.find(x => x.combo.toLowerCase() === h.combo.toLowerCase())
  if (owner && owner.pluginId !== h.pluginId) {
    throw new PluginLimit(`Сочетание ${h.combo} уже занято другим плагином.`)
  }
  reg.hotkeys = [...reg.hotkeys.filter(x => x.combo !== h.combo || x.pluginId !== h.pluginId), h]
  notify()
}

export function setSettingsPage(p: PluginSettingsPage) {
  if (disabled) throw new PluginLimit('Плагины выключены аварийным режимом')
  reg.settingsPages = [...reg.settingsPages.filter(x => x.pluginId !== p.pluginId), p]
  notify()
}

/** Снять всё, что зарегистрировал плагин, — при выключении и при удалении. */
export function clearPlugin(pluginId: string) {
  reg.composerButtons = reg.composerButtons.filter(x => x.pluginId !== pluginId)
  reg.messageActions = reg.messageActions.filter(x => x.pluginId !== pluginId)
  reg.commands = reg.commands.filter(x => x.pluginId !== pluginId)
  reg.settingsPages = reg.settingsPages.filter(x => x.pluginId !== pluginId)
  reg.panels = reg.panels.filter(x => x.pluginId !== pluginId)
  reg.hotkeys = reg.hotkeys.filter(x => x.pluginId !== pluginId)
  const el = styleEls.get(pluginId)
  if (el) { el.remove(); styleEls.delete(pluginId) }
  notify()
}

/** Занято ли имя команды другим плагином — команды глобальны, дубли надо ловить. */
export function commandOwner(name: string): string | null {
  return reg.commands.find(c => c.name === name)?.pluginId ?? null
}
export const useComposerButtons = () => useReg(() => reg.composerButtons)
export const useMessageActions = () => useReg(() => reg.messageActions)
export const useSlashCommands = () => useReg(() => reg.commands)
export const useSettingsPages = () => useReg(() => reg.settingsPages)
/** Панели плагинов в конкретном месте приложения (v1.417.0). */
export const usePanels = (slot: PanelSlot) => useReg(() => reg.panels.filter(p => p.slot === slot))
/** Горячие клавиши плагинов (v1.419.0) — слушает App.tsx, показывает окно сочетаний. */
export const useHotkeys = () => useReg(() => reg.hotkeys)
export const getHotkeys = (): PluginHotkey[] => reg.hotkeys
