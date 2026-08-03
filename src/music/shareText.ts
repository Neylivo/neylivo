// v1.440.0: текст сообщения «вот тебе песня» — чистой функцией и отдельно.
//
// Отдельно от самой отправки (shareTrack.ts) по той же причине, что и в других
// местах проекта: отправка тянет supabase, а он в сборке проверок падает на
// import.meta.env. Проверять надо именно текст — его видит человек.

export interface ShareTrackInfo {
  title: string
  author?: string | null
  url: string
}

/**
 * Что увидит собеседник.
 *
 * Строка, а не карточка: карточку пришлось бы учить показывать старые версии
 * приложения, а строка со ссылкой читается везде и одинаково — и из неё сразу
 * видно, что прислали песню, а не случайный адрес.
 */
export function shareTrackText(t: ShareTrackInfo, note?: string): string {
  const name = (t.title || 'Трек').trim() || 'Трек'
  const who = (t.author || '').trim()
  const head = '🎵 ' + name + (who ? ' — ' + who : '')
  const tail = (note || '').trim()
  return [head, t.url, tail].filter(Boolean).join('\n')
}
