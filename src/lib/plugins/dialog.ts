// v1.475.0: своё окно-вопрос у плагина.
//
// Зачем. У плагина было ровно два способа спросить человека: ui.confirm («да/
// нет») и ui.prompt (одна строка). Всё, что сложнее — мастер настройки, форма
// с несколькими полями, выбор из списка вместе с переключателем, — приходилось
// лепить из панели на сто пикселей или из нескольких вопросов подряд.
//
// ЧТО НЕ ИЗМЕНИЛОСЬ. Плагин по-прежнему ничего не рисует. Он описывает СТРОКИ —
// те же самые, что в панели и в настройках, — а окно рисует приложение, своей
// разметкой, со своей шапкой и своими кнопками. Поэтому окном плагина нельзя
// подделать окно Ponoi: чужой разметки в нём не появляется.
//
// ПОЧЕМУ ЧЕРЕЗ СОБЫТИЕ ОКНА, А НЕ ЧЕРЕЗ КОНТЕКСТ ЧАТА. ui.confirm и ui.prompt
// живут на контексте, который подставляет открытый чат (Composer). Значит, без
// открытого чата их нет вовсе: плагин со своей страницы настроек спросить
// человека не мог. Здесь этой привязки нет — окно живёт над всем приложением,
// как ConfirmHost.
//
// Проверки: src/lib/plugins/__test.ts, __attack_test.ts и живая в __live_test.ts.

import type { SettingsRow } from './registry'

/** Сколько строк в одном окне. Больше — это уже не вопрос, а экран. */
/** Сколько окон плагин может открыть разом. Ровно одно: очередь из вопросов,
 *  которую нельзя закрыть, — это захват экрана. */
// v1.489.0: числа открытых окон-вопросов больше нет — их можно сколько
// угодно, показывается последнее. Раньше стояло «одно за раз».

export class DialogError extends Error {}

export interface DialogSpec {
  pluginId: string
  /** Имя плагина — рисуется в шапке. Человек обязан видеть, кто спрашивает. */
  pluginName: string
  title: string
  text: string
  okText: string
  cancelText: string
  rows: SettingsRow[]
}

export interface DialogAsk extends DialogSpec {
  id: number
  resolve: (v: Record<string, unknown> | null) => void
}

/** Виды строк, которые в окне-вопросе имеют смысл. */
const РАЗРЕШЁННЫЕ = new Set(['label', 'text', 'toggle', 'select', 'slider', 'color', 'image'])

/**
 * Отобрать строки, годные для вопроса.
 *
 * Кнопка и холст сюда не пускаются намеренно: кнопка в окне-вопросе — это
 * второй, никем не ожидаемый выход из него, а холст означал бы, что плагин
 * рисует в модальном окне поверх всего приложения. Ответ окна — это значения
 * полей, и ничего больше.
 */
export function dialogRows(rows: SettingsRow[]): SettingsRow[] {
  // v1.489.0: строк в окне-вопросе сколько угодно.
  return rows.filter(r => РАЗРЕШЁННЫЕ.has(r.type))
}

/** Значения по умолчанию — то, что вернётся, если человек ничего не трогал. */
export function dialogDefaults(rows: SettingsRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    if (r.type === 'label' || r.type === 'image') continue
    out[r.key] = (r as { value?: unknown }).value
  }
  return out
}

let открыто = 0
let seq = 1

/**
 * Спросить человека. Возвращает значения строк или null, если он отказался.
 *
 * Отказ — это именно null, а не пустой объект: «человек нажал отмену» и
 * «человек ничего не менял» — разные вещи, и плагин должен уметь их различать.
 */
export function askDialog(spec: DialogSpec): Promise<Record<string, unknown> | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  открыто++
  return new Promise(resolve => {
    const ask: DialogAsk = {
      ...spec, id: seq++,
      resolve: v => { открыто = Math.max(0, открыто - 1); resolve(v) },
    }
    window.dispatchEvent(new CustomEvent('ponoi-plugin-dialog', { detail: ask }))
  })
}

/** Сколько окон открыто — видно проверкам. */
export const openDialogs = () => открыто

/** Уборка: плагин выключили, пока он ждал ответа. Считаем это отказом —
 *  иначе его обещание висело бы вечно, а счётчик не давал бы открыть новое. */
export function clearDialogs(pluginId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ponoi-plugin-dialog-close', { detail: { pluginId } }))
}

export function clearAllDialogs() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ponoi-plugin-dialog-close', { detail: { pluginId: null } }))
}

// Счётчик уменьшается ровно в одном месте — в обёртке resolve выше. Второе
// место («окно закрылось») рано или поздно сработало бы вместе с первым, и
// плагин потерял бы право открывать окна вовсе.
