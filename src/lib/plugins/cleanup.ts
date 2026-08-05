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
import { clearApps, clearAllApps, forgetWidget, forgetAllWidgets } from './apps'
import { clearServices, clearAllServices } from './services'
import { clearAssetUrls, clearAllAssetUrls } from './assets'
import { unwatchGamepads, unwatchAllGamepads } from './gamepads'
import { clearDialogs, clearAllDialogs } from './dialog'

/** Всё, что плагин оставляет после себя вне интерфейса. По одной паре на вид:
 *  «убрать за этим» и «убрать за всеми». */
const SUBSYSTEMS: { one: (id: string) => void; all: () => void }[] = [
  { one: clearInterceptors, all: clearAllInterceptors },
  { one: closeAllFor, all: closeAllSockets },
  { one: clearTasks, all: clearAllTasks },
  { one: clearPluginTheme, all: clearAllThemes },
  { one: clearCanvases, all: clearAllCanvases },
  // v1.471.0: окно плагина не исчезает от того, что плагин выключили: оно
  // нарисовано приложением и осталось бы висеть поверх экрана.
  { one: clearApps, all: clearAllApps },
  // v1.480.0: и память о том, какой виджет чей, — иначе после
  // перезапуска плагина его ui.addPanel обновлял бы уже закрытое окно
  // и на экране не появлялось бы ничего.
  { one: forgetWidget, all: forgetAllWidgets },
  // v1.472.0: службы. Останься запись в реестре — её метки функций вели бы в
  // остановленный плагин, и чужой вызов молча висел бы до срока.
  { one: clearServices, all: clearAllServices },
  // v1.473.0: адреса файлов живут в окне и сами не пропадают — это течь
  // памяти на каждое включение-выключение плагина. Сами файлы остаются: их
  // убирает удаление плагина, а не выключение.
  { one: clearAssetUrls, all: clearAllAssetUrls },
  // v1.473.0: опрос геймпадов идёт кадрами. Забудь мы его снять — приложение
  // продолжало бы будить себя шестьдесят раз в секунду ради выключенного
  // плагина, и человек увидел бы только севшую батарею.
  { one: unwatchGamepads, all: unwatchAllGamepads },
  // v1.475.0: окно-вопрос. Останься оно на экране от выключенного плагина —
  // отвечать было бы некому, а само окно висело бы поверх всего.
  { one: clearDialogs, all: clearAllDialogs },
]

export const SUBSYSTEM_COUNT = SUBSYSTEMS.length

export function cleanupPlugin(pluginId: string) {
  for (const s of SUBSYSTEMS) { try { s.one(pluginId) } catch {} }
}

/** Аварийный режим: человек нажал «выключить все плагины». */
export function cleanupAllPlugins() {
  for (const s of SUBSYSTEMS) { try { s.all() } catch {} }
}
