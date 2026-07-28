// v1.357.0: чужой текст, который нельзя переводить.
//
// Всё, что назвал человек, — имя сервера, канала, роли, ник, статус, название
// бота — оборачивается в это. Переводчик интерфейса (src/lib/i18n.ts) видит
// класс .notr и проходит мимо, а translate="no" останавливает ещё и встроенный
// переводчик браузера.
//
// Почему не «умный» переводчик, который сам отличит своё от чужого: отличить
// нельзя. Роль «Участник» и подпись «Участник» — одна и та же строка, разница
// только в том, откуда она взялась. Знает об этом только то место, где её
// рисуют, — поэтому помечаем там.
import type { ReactNode, CSSProperties } from 'react'

export function Ugc({ children, className, style, title, as: Tag = 'span' }: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  title?: string
  as?: 'span' | 'div' | 'b' | 'strong'
}) {
  return <Tag className={className ? className + ' notr' : 'notr'} style={style} title={title} translate="no">{children}</Tag>
}
