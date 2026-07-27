// v1.312.0: проверка адресов, пришедших из сообщений.
//
// Адрес вложения приходит вместе с сообщением, то есть его задаёт отправитель, а
// не приложение. До сих пор он попадал прямо в <a href>, в src картинки и, что
// хуже всего, в window.open — без единой проверки.
//
// Почему это было опасно именно здесь. Браузер сам блокирует переход по ссылке
// вида javascript: при клике по <a>, и на этом легко успокоиться. Но window.open
// с таким адресом ВЫПОЛНЯЕТСЯ — проверено в этой самой среде, — а выполняется он
// в окне того же происхождения и с доступом к window.opener. То есть к
// localStorage, где лежит токен сессии. Достаточно было прислать вложение с таким
// адресом и дождаться, пока получатель нажмёт «Открыть в браузере».
//
// Поэтому: разрешаем ровно те схемы, которые нужны для показа вложений, и ничего
// сверх. Список закрытый — при появлении новой схемы её придётся вписать сюда
// осознанно, а не получить по умолчанию.
const ALLOWED = ['http:', 'https:', 'blob:']

/** Адрес пригоден для показа и открытия? */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const raw = String(url).trim()
  // Относительные адреса ведут внутрь самого приложения — они безопасны и нужны
  // для собственных ресурсов.
  if (raw.startsWith('/') || raw.startsWith('./')) return true
  try {
    return ALLOWED.includes(new URL(raw, location.href).protocol)
  } catch {
    return false
  }
}

/** Адрес, если он безопасен, иначе null — вызывающая сторона показывает заглушку. */
export function safeUrl(url: string | null | undefined): string | null {
  return isSafeUrl(url) ? String(url).trim() : null
}

/** Открыть внешний адрес, предварительно проверив. Возвращает false, если отказано. */
export function openSafely(url: string | null | undefined): boolean {
  const ok = safeUrl(url)
  if (!ok) return false
  window.open(ok, '_blank', 'noopener,noreferrer')
  return true
}
