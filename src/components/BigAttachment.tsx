import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { toastErr } from '../lib/toast'
import { размерСловами } from '../lib/bigFile'
import { сведения, собрать, скачатьБольшой, type BigInfo } from '../lib/bigUpload'

// v1.545.0: вложение, которое лежит в хранилище кусками.
//
// Владелец: «сделай чтобы даже без зависимости серверов загружались файлы
// больше 45 МБ». Отправка кусками — в bigUpload.ts; здесь то, что человек видит
// на месте такого вложения.
//
// ПОЧЕМУ НЕ СОБИРАЕТСЯ САМО. Прокрутка мимо чужого клипа на двести мегабайт не
// должна съедать двести мегабайт памяти и трафика. Поэтому сперва карточка —
// имя, вес, число кусков — и только по нажатию сборка. Это ровно то же
// обещание, что даёт любой мессенджер: большое качается по требованию.
export function BigAttachment({ url }: { url: string }) {
  const [инфо, setИнфо] = useState<BigInfo | null>(null)
  const [беда, setБеда] = useState<string | null>(null)
  const [доля, setДоля] = useState<number | null>(null)
  const [готовый, setГотовый] = useState<string | null>(null)

  useEffect(() => {
    let жив = true
    сведения(url).then(и => { if (жив) setИнфо(и) })
      .catch(e => { if (жив) setБеда(String((e as Error)?.message || e)) })
    return () => { жив = false }
  }, [url])

  async function собратьИПоказать() {
    if (доля != null) return
    setДоля(0)
    try { setГотовый(await собрать(url, setДоля)) }
    catch (e) { toastErr(e); setДоля(null) }
  }

  async function скачать() {
    if (доля != null) return
    setДоля(0)
    try { await скачатьБольшой(url, setДоля) }
    catch (e) { toastErr(e) } finally { setДоля(null) }
  }

  if (беда) return <span className="msg-att-broken"><Icon name="shield" size={16} /> {беда}</span>
  if (!инфо) return <span className="msg-att-broken"><Icon name="file" size={16} /> Смотрю файл…</span>

  const картинка = инфо.type.startsWith('image/')
  const видео = инфо.type.startsWith('video/')

  // Собрали — показываем как обычное вложение.
  if (готовый && картинка) return <img className="msg-att" src={готовый} alt={инфо.name} />
  if (готовый && видео) return <video className="msg-att" src={готовый} controls />

  return (
    <div className="bigatt">
      <span className="bigatt-ic"><Icon name={видео ? 'video' : картинка ? 'image' : 'file'} size={20} /></span>
      <span className="bigatt-meta">
        <span className="bigatt-nm">{инфо.name}</span>
        <span className="bigatt-sub">
          {размерСловами(инфо.size)} · {инфо.parts} {склонение(инфо.parts)}
          {доля != null && ' · собираем ' + Math.round(доля * 100) + '%'}
        </span>
      </span>
      {(картинка || видео) && <button className="pqs2-btn" disabled={доля != null}
        onClick={() => void собратьИПоказать()}>Показать</button>}
      <button className="pqs2-btn primary" disabled={доля != null} onClick={() => void скачать()}>
        <Icon name="download" size={15} /> Скачать
      </button>
    </div>
  )
}

/** «1 часть», «2 части», «5 частей» — иначе подпись читается как машинная. */
function склонение(n: number): string {
  const д = n % 10, дд = n % 100
  if (дд >= 11 && дд <= 14) return 'частей'
  if (д === 1) return 'часть'
  if (д >= 2 && д <= 4) return 'части'
  return 'частей'
}
