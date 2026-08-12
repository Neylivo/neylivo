// v1.556.0: приложение не попадает в снимки и записи экрана.
//
// Владелец: «сделай чтобы приложение нельзя вообще никак сфоткать сообщение
// например при скриншоте или видео записи все сообщение замазаны и не видно».
//
// ЗДЕСЬ ДВЕ РАЗНЫЕ МЕРЫ, и путать их нельзя.
//
//   1. ЗАЩИТА ОТ ЗАХВАТА (`setCaptureGuard`). Система сама отказывается отдавать
//      содержимое окна: на Windows — WDA_EXCLUDEFROMCAPTURE, на Android —
//      FLAG_SECURE. Снимок, «Ножницы», OBS, демонстрация экрана в звонке видят
//      чёрное, а на Android снимок вообще не делается. Это не наша заслонка
//      поверх картинки — это отказ системы, обойти его прикладной программой
//      нельзя.
//
//   2. СКРЫТИЕ ТЕКСТА (`setBlurMessages`). Сообщения размыты, пока на них не
//      навели мышь (на телефоне — пока не коснулись). Это против съёмки со
//      стороны и взгляда через плечо.
//
// ПОЧЕМУ НУЖНЫ ОБЕ. Первая не закрывает фотографию экрана чужим телефоном — и
// не может: с экрана идёт свет, и он одинаково попадает и в глаз, и в камеру.
// Никакая программа не сделает так, чтобы человек текст видел, а камера нет.
// Всё, что можно противопоставить съёмке со стороны, — не держать текст
// открытым, пока его не читают. Это и делает вторая.
//
// ГДЕ ПЕРВАЯ НЕ РАБОТАЕТ ВОВСЕ: в браузере. У веба нет и не предвидится способа
// запретить снимок экрана — там нам не принадлежит ни окно, ни его отрисовка.
// Поэтому `captureGuardAvailable()` честно отвечает «нет», а настройка это
// показывает, вместо того чтобы притворяться включённой.

import { registerPlugin } from '@capacitor/core'
import { IS_MOBILE } from './mobile'

interface CaptureGuardPlugin {
  set(o: { on: boolean }): Promise<{ on: boolean }>
  get(): Promise<{ on: boolean }>
}
const Native = registerPlugin<CaptureGuardPlugin>('CaptureGuard')

const desktop = () => (window as any).neylivoDesktop as
  { captureGuard?: (on?: boolean) => Promise<boolean> } | undefined

/** Где приложение — своё окно, у которого можно отнять содержимое. */
const наAndroid = () => IS_MOBILE && !!(window as any).Capacitor?.isNativePlatform?.()

/**
 * Можно ли здесь запретить съёмку экрана вообще.
 *
 * Отвечает по МЕСТУ, а не по настройке: в браузере ответ «нет» всегда, и
 * настройка обязана это показывать. Молча выключенный переключатель, который
 * выглядит рабочим, — худший вид обмана в настройках приватности: человек
 * решит, что защищён.
 */
export function captureGuardAvailable(): boolean {
  return !!desktop()?.captureGuard || наAndroid()
}

/** Почему недоступно — человеку словами. Пусто, если доступно. */
export function captureGuardWhyNot(): string {
  if (captureGuardAvailable()) return ''
  return 'В браузере запретить снимок экрана нельзя: окном и его отрисовкой распоряжается браузер, '
    + 'а не приложение. Работает в программе на компьютере и в приложении на телефоне. '
    + 'Здесь помогает «Скрывать сообщения» — оно работает везде.'
}

/**
 * Включить или выключить защиту.
 *
 * @returns что получилось НА САМОМ ДЕЛЕ. Не «что попросили»: если система
 *   отказала, настройка должна показать отказ, а не желаемое.
 */
export async function setCaptureGuard(on: boolean): Promise<boolean> {
  try {
    const d = desktop()
    if (d?.captureGuard) return await d.captureGuard(on)
    if (наAndroid()) return (await Native.set({ on })).on
  } catch { /* ниже */ }
  return false
}

/** Стоит ли защита сейчас. Спрашиваем систему, а не свою память о ней. */
export async function getCaptureGuard(): Promise<boolean> {
  try {
    const d = desktop()
    if (d?.captureGuard) return await d.captureGuard()
    if (наAndroid()) return (await Native.get()).on
  } catch { /* ниже */ }
  return false
}

// ── Скрытие текста ─────────────────────────────────────────────────────────

const КЛЮЧ = 'ponoi.blurMessages'   // имя ключа не трогаем: у людей уже сохранён этот выбор

export function blurMessages(): boolean {
  try { return localStorage.getItem(КЛЮЧ) === '1' } catch { return false }
}

/**
 * Размыть сообщения до наведения.
 *
 * Признак вешается на корень документа, а не на каждое сообщение: список
 * переписки перерисовывается постоянно, и настройка, которую надо не забыть
 * применить к каждому новому пузырю, однажды к нему не применится — как раз к
 * тому, что пришёл в момент съёмки.
 */
export function setBlurMessages(on: boolean) {
  try { localStorage.setItem(КЛЮЧ, on ? '1' : '0') } catch { /* приватный режим */ }
  applyBlurMessages()
}

export function applyBlurMessages() {
  try { document.documentElement.classList.toggle('hide-msg', blurMessages()) } catch { }
}

/**
 * Открыть сообщение прикосновением — на время.
 *
 * Наведения мышью на телефоне нет, и без этого размытие превращалось бы там в
 * «читать нельзя вообще». Открываем ОДНО сообщение и ненадолго: смысл меры в
 * том, что на экране в каждый момент открыто ровно то, что человек сейчас
 * читает, а не вся переписка.
 *
 * Вешается один раз на весь документ и НИЧЕГО не отменяет: выделение, меню по
 * долгому нажатию и ссылки внутри сообщения продолжают работать как работали.
 */
let слушаем = false
export function watchBlurTaps() {
  if (слушаем) return
  слушаем = true
  document.addEventListener('pointerup', e => {
    if (!blurMessages()) return
    const цель = (e.target as HTMLElement | null)?.closest?.('.msg') as HTMLElement | null
    if (!цель) return
    цель.classList.add('open')
    const было = Number(цель.dataset.открыт || 0)
    if (было) clearTimeout(было)
    цель.dataset.открыт = String(setTimeout(() => {
      цель.classList.remove('open')
      delete цель.dataset.открыт
    }, 10000))
  }, true)
}
