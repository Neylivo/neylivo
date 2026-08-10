import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { fileKind, fileSub, sizeText, fileNameOf } from '../lib/fileKind'
import { peekZip, type ZipPeek } from '../lib/zipPeek'
import { copyMediaLink, saveMedia } from '../lib/copyMedia'
import { openSafely } from '../lib/safeUrl'
import { toastOk } from '../lib/toast'

// v1.529.0: карточка файла вместо синей строчки «Скачать файл».
//
// Владелец: «сделай кнопку скачать файл удобной, чтобы можно было посмотреть
// название, содержание и так далее».
//
// Что было. Картинки показывались картинками, текст и код — карточкой с
// превью. Всё остальное — архив, установщик, видео, документ — одной синей
// ссылкой «Скачать файл 47.8 МБ»: ни имени, ни типа, ни содержимого. Человек
// узнавал, что скачал, только после скачивания.
//
// Что теперь. Значок по типу, полное имя, тип и размер, кнопка скачивания и
// меню («открыть», «копировать ссылку»). У архива — список того, что внутри:
// zip хранит опись в конце файла, и её видно, не качая архив целиком (см.
// lib/zipPeek.ts).
//
// Чего здесь НЕТ и не будет: выдуманного содержимого. Не смогли заглянуть —
// так и написано, а не «файл, вероятно, содержит…».

export function FileCard({ url, name: nameProp, size, desc }: {
  url: string
  name?: string | null
  /** Размер в байтах, если известен. */
  size?: number | null
  desc?: string | null
}) {
  const name = fileNameOf(url, nameProp)
  const вид = fileKind(name)
  const [опись, setОпись] = useState<ZipPeek | null | undefined>(undefined)
  const [развёрнут, setРазвёрнут] = useState(false)
  const [меню, setМеню] = useState(false)

  // В архив заглядываем один раз и только по просьбе: лишний запрос на каждое
  // сообщение с архивом в ленте — это трафик за просто так.
  useEffect(() => {
    if (вид.kind !== 'archive' || !развёрнут || опись !== undefined) return
    let жив = true
    peekZip(url, size).then(r => { if (жив) setОпись(r) })
    return () => { жив = false }
  }, [развёрнут, url, size, вид.kind, опись])

  // saveMedia сама берёт имя из ссылки и метаданных — второго довода у неё нет.
  const скачать = () => { void saveMedia(url) }

  return (
    <div className="fcard">
      <div className="fcard-row">
        <span className={'fcard-ic fcard-' + вид.kind}><Icon name={вид.icon} size={20} /></span>
        <span className="fcard-meta">
          <span className="fcard-nm" title={name}>{name}</span>
          <span className="fcard-sub">{fileSub(name, size)}</span>
        </span>
        {вид.kind === 'archive' && (
          <button type="button" className="fcard-btn" title="Посмотреть, что внутри"
            onClick={() => setРазвёрнут(v => !v)}>
            <Icon name={развёрнут ? 'chevron-up' : 'chevron-down'} size={16} />
          </button>
        )}
        <button type="button" className="fcard-btn" title="Скачать" onClick={скачать}>
          <Icon name="download" size={16} />
        </button>
        <div className="fcard-more">
          <button type="button" className="fcard-btn" title="Ещё" onClick={() => setМеню(v => !v)}>
            <Icon name="more" size={16} />
          </button>
          {меню && <>
            <div className="fcard-menu-ov" onClick={() => setМеню(false)} />
            <div className="fcard-menu">
              <button type="button" onClick={() => { setМеню(false); openSafely(url) }}>
                <Icon name="link" size={15} /> Открыть в браузере
              </button>
              <button type="button" onClick={() => { setМеню(false); void copyMediaLink(url); toastOk('Ссылка скопирована') }}>
                <Icon name="copy" size={15} /> Копировать ссылку
              </button>
            </div>
          </>}
        </div>
      </div>

      {desc && <div className="fcard-desc">{desc}</div>}

      {развёрнут && вид.kind === 'archive' && (
        <div className="fcard-inside">
          {опись === undefined && <div className="fcard-hint">Смотрю, что внутри…</div>}
          {опись === null && <div className="fcard-hint">Заглянуть внутрь не вышло — сервер не отдал кусок файла.</div>}
          {опись && опись.entries.length === 0 && <div className="fcard-hint">Архив пуст или запаковано непривычно.</div>}
          {опись && опись.entries.length > 0 && <>
            <div className="fcard-inside-hd">
              Внутри {опись.total || опись.entries.length}{опись.full ? '' : ' (показаны не все)'}
            </div>
            <div className="fcard-list">
              {опись.entries.slice(0, 40).map((э, i) => (
                <div key={э.name + i} className="fcard-item">
                  <Icon name={э.dir ? 'folder' : 'file'} size={14} />
                  <span className="fcard-item-nm" title={э.name}>{э.name}</span>
                  {!э.dir && <span className="fcard-item-sz">{sizeText(э.size)}</span>}
                </div>
              ))}
            </div>
            {опись.entries.length > 40 && (
              <div className="fcard-hint">…и ещё {опись.entries.length - 40}</div>
            )}
          </>}
        </div>
      )}
    </div>
  )
}
