// v1.465.0: уборка за плагином — одним местом.
//
// Зачем отдельный файл. До этой версии плагин оставлял после себя ровно то, что
// добавил в интерфейс: кнопки, панели, стили. Их снимал clearPlugin в
// registry.ts, и одного места хватало.
//
// Теперь плагин оставляет после себя то, что РАБОТАЕТ САМО:
//   • перехватчик — продолжит править каждое отправляемое сообщение;
//   • сокет — продолжит слушать чужой сервер;
//   • фоновая задача — продолжит будить приложение по таймеру;
//   • тема — оставит приложение перекрашенным;
//   • холст — останется висеть элементом.
//
// Ни одно из этого не умирает от того, что воркер убит: воркер убит, а таймер в
// приложении тикает. Значит, забытая строка здесь превращается в ВЫКЛЮЧЕННЫЙ
// плагин, который продолжает работать, — и человек, нажавший «выключить», об
// этом не узнает.
//
// Мест, где надо убирать, два: остановка одного плагина и аварийный режим
// («выключить все»). Списки этих двух мест обязаны совпадать, а два списка
// рано или поздно расходятся — поэтому список один, вот он, и на его полноту
// есть отдельная проверка в __test.ts.

import { clearInterceptors, clearAllInterceptors } from './middleware'
import { closeAllFor, closeAllSockets } from './wsHub'
import { clearTasks, clearAllTasks } from './background'
import { clearPluginTheme, clearAllThemes } from './pluginTheme'
import { clearCanvases, clearAllCanvases } from './canvasHub'

/** Всё, что плагин оставляет после себя вне интерфейса. По одной паре на вид:
 *  «убрать за этим» и «убрать за всеми». */
const SUBSYSTEMS: { one: (id: string) => void; all: () => void }[] = [
  { one: clearInterceptors, all: clearAllInterceptors },
  { one: closeAllFor, all: closeAllSockets },
  { one: clearTasks, all: clearAllTasks },
  { one: clearPluginTheme, all: clearAllThemes },
  { one: clearCanvases, all: clearAllCanvases },
]

export const SUBSYSTEM_COUNT = SUBSYSTEMS.length

export function cleanupPlugin(pluginId: string) {
  for (const s of SUBSYSTEMS) { try { s.one(pluginId) } catch {} }
}

/** Аварийный режим: человек нажал «выключить все плагины». */
export function cleanupAllPlugins() {
  for (const s of SUBSYSTEMS) { try { s.all() } catch {} }
}
