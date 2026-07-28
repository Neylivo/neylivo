import { useRef, useState } from 'react'
import { Icon } from './icons'
import { toastErr } from '../lib/toast'
import { uploadTo, isImage } from '../lib/storage'
import { useAuth } from '../auth/AuthProvider'

// v1.351.0: поле картинки — ссылкой ИЛИ файлом.
//
// Раньше аватарку и шапку боту и плагину можно было задать только ссылкой. Это
// требовало сначала где-то выложить картинку и только потом принести адрес —
// то есть у человека без своего хостинга картинок не было вовсе. Здесь тот же
// путь загрузки, что у обычной аватарки: файл уходит в хранилище приложения, а
// в поле подставляется его адрес.
//
// Адрес остаётся видимым и правится руками: и база, и разбор плагина проверяют
// именно его, поэтому прятать поле было бы нечестно — человек должен видеть,
// что именно сохранится.

/** Картинка — вещь необязательная, но крупная: держим потолок явным. */
const MAX_BYTES = 4 * 1024 * 1024

export function PicField({ label, hint, value, onChange, placeholder }: {
  label: string
  hint?: string
  value: string
  onChange: (url: string) => void
  placeholder?: string
}) {
  const { user } = useAuth()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(f: File | null) {
    if (ref.current) ref.current.value = ''
    if (!f || !user) return
    if (!isImage(f)) { toastErr('Это не картинка — нужен png, jpg, gif или webp'); return }
    if (f.size > MAX_BYTES) { toastErr(`Картинка больше ${MAX_BYTES / 1024 / 1024} МБ`); return }
    setBusy(true)
    try {
      onChange(await uploadTo('avatars', user.id, f))
    } catch (e: any) {
      toastErr('Не удалось загрузить: ' + (e?.message ?? e))
    } finally { setBusy(false) }
  }

  return (
    <div className="picf">
      <label className="modal-lbl">{label}</label>
      <div className="picf-row">
        <span className="picf-prev">
          {value.trim()
            ? <img src={value.trim()} alt="" onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
            : <Icon name="image" size={16} />}
        </span>
        <input className="modal-in" value={value} placeholder={placeholder ?? 'https://…'}
          onChange={e => onChange(e.target.value)} />
        <button className="pqs2-btn ghost" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? 'Загрузка…' : <><Icon name="download" size={15} /> Файл</>}
        </button>
        {value.trim() && (
          <button className="pqs2-btn ghost danger" title="Убрать" onClick={() => onChange('')}>
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
      {hint && <div className="cset-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}
