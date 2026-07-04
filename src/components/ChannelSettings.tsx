// Полноэкранные настройки канала — 1-в-1 как в Discord (v1.24.0).
// У текстовых каналов вкладки: Обзор / Права доступа / Приглашения / Интеграция.
// У голосовых — те же, но БЕЗ «Интеграции» (прямое указание пользователя),
// а в «Обзоре» дополнительно битрейт, качество видео, лимит пользователей и регион.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { createInvite } from '../lib/servers'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel } from '../types'
import { Icon } from './icons'

const SLOW_OPTS = ['Выкл', '5с', '10с', '15с', '30с', '1м', '2м', '5м', '10м', '15м', '30м', '1ч', '2ч', '6ч']
const HIDE_OPTS = ['1 час', '24 часа', '3 дней', '1 неделя']
const REGIONS = ['Автоматически', 'Россия', 'Европа', 'США Восток', 'США Запад', 'Азия']

type Tri = 'deny' | 'default' | 'allow'
const MAIN_PERMS: { k: string; t: string; d: string }[] = [
  { k: 'view', t: 'Просмотр канала', d: 'Позволяет участникам просматривать этот канал по умолчанию. Отключив у @everyone это право, вы сделаете этот канал приватным.' },
  { k: 'manage', t: 'Управлять каналом', d: 'Позволяет участникам менять название, описание и настройки этого канала. Также даёт право удалить этот канал.' },
  { k: 'perms', t: 'Управлять правами', d: 'Позволяет участникам менять права этого канала.' },
  { k: 'webhooks', t: 'Управлять вебхуками (webhooks)', d: 'Позволяет участникам создавать, редактировать и удалять вебхуки этого канала, которые публикуют сообщения из других приложений и с сайтов.' },
]
const MEMBER_PERMS: { k: string; t: string; d: string }[] = [
  { k: 'invite', t: 'Создание приглашения', d: 'Позволяет участникам приглашать на этот сервер.' },
  { k: 'send', t: 'Отправлять сообщения', d: 'Позволяет участникам отправлять сообщения в этом канале.' },
]

export function ChannelSettings({ server, channel, onClose, onChanged, onDeleted }: {
  server: Server; channel: Channel; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const { user } = useAuth()
  const isVoice = (channel as any).kind === 'voice'
  const s0: any = (channel as any).settings ?? {}
  const [tab, setTab] = useState<'overview' | 'perms' | 'invites' | 'integrations'>('overview')
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState<string>((channel as any).topic ?? '')
  const [slow, setSlow] = useState<string>(s0.slow ?? 'Выкл')
  const [nsfw, setNsfw] = useState<boolean>(!!s0.nsfw)
  const [hide, setHide] = useState<string>(s0.hide ?? '3 дней')
  const [bitrate, setBitrate] = useState<number>(s0.bitrate ?? 64)
  const [vq, setVq] = useState<'auto' | '720p'>(s0.video_quality ?? 'auto')
  const [limit, setLimit] = useState<number>(s0.user_limit ?? 0)
  const [region, setRegion] = useState<string>(s0.region ?? 'Автоматически')
  const [priv, setPriv] = useState<boolean>(!!s0.private)
  const [perms, setPerms] = useState<Record<string, Tri>>(s0.perms ?? {})
  const [paused, setPaused] = useState<boolean>(!!s0.invites_paused)
  const [invites, setInvites] = useState<any[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (tab !== 'invites') return
    supabase.from('server_invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false })
      .then(({ data }) => setInvites(data ?? []))
  }, [tab, server.id])

  function setPerm(k: string, v: Tri) { setPerms(p => ({ ...p, [k]: v })); setDirty(true) }

  async function save() {
    const settings = { ...s0, slow, nsfw, hide, bitrate, video_quality: vq, user_limit: limit, region, private: priv, perms, invites_paused: paused }
    const nm = name.trim() || channel.name
    const { error } = await supabase.from('channels').update({ name: nm, topic: topic || null, settings } as any).eq('id', channel.id)
    if (error) {
      // Скорее всего не применена миграция 16 — сохраняем хотя бы название.
      const r2 = await supabase.from('channels').update({ name: nm }).eq('id', channel.id)
      if (r2.error) return toastErr(r2.error.message)
      toastErr('Для темы и настроек примени миграцию supabase/16_channel_settings.sql')
    }
    setDirty(false)
    toastOk('Изменения сохранены')
    onChanged()
  }

  function reset() {
    setName(channel.name); setTopic((channel as any).topic ?? ''); setSlow(s0.slow ?? 'Выкл'); setNsfw(!!s0.nsfw)
    setHide(s0.hide ?? '3 дней'); setBitrate(s0.bitrate ?? 64); setVq(s0.video_quality ?? 'auto'); setLimit(s0.user_limit ?? 0)
    setRegion(s0.region ?? 'Автоматически'); setPriv(!!s0.private); setPerms(s0.perms ?? {}); setPaused(!!s0.invites_paused)
    setDirty(false)
  }

  async function del() {
    if (!await confirmUi('Удалить канал «' + channel.name + '»? Это действие необратимо.', { okText: 'Удалить канал' })) return
    const { error } = await supabase.from('channels').delete().eq('id', channel.id)
    if (error) return toastErr(error.message)
    toastOk('Канал удалён')
    onDeleted()
  }

  async function makeInvite() {
    if (!user) return
    const res = await createInvite(server.id, user.id)
    if (res.error) return toastErr(res.error.message)
    try { await navigator.clipboard.writeText(res.code!) } catch {}
    toastOk('Код приглашения скопирован: ' + res.code)
    const { data } = await supabase.from('server_invites').select('*').eq('server_id', server.id).order('created_at', { ascending: false })
    setInvites(data ?? [])
  }

  async function revoke(id: string) {
    await supabase.from('server_invites').delete().eq('id', id)
    setInvites(list => list.filter(i => i.id !== id))
  }

  const tri = (k: string) => {
    const v: Tri = perms[k] ?? 'default'
    return (
      <div className="cset-tri">
        <button className={'deny' + (v === 'deny' ? ' on' : '')} title="Запретить" onClick={() => setPerm(k, 'deny')}><Icon name="close" size={13} /></button>
        <button className={'def' + (v === 'default' ? ' on' : '')} title="По умолчанию" onClick={() => setPerm(k, 'default')}>／</button>
        <button className={'allow' + (v === 'allow' ? ' on' : '')} title="Разрешить" onClick={() => setPerm(k, 'allow')}><Icon name="check" size={13} /></button>
      </div>
    )
  }

  return createPortal(
    <div className="cset">
      <div className="cset-side">
        <nav className="cset-nav">
          <div className="cset-cat">{isVoice ? '🔊 ' : '# '}{channel.name} — {isVoice ? 'голосовые каналы' : 'текстовые каналы'}</div>
          <div className={'cset-tab' + (tab === 'overview' ? ' on' : '')} onClick={() => setTab('overview')}>Обзор</div>
          <div className={'cset-tab' + (tab === 'perms' ? ' on' : '')} onClick={() => setTab('perms')}>Права доступа</div>
          <div className={'cset-tab' + (tab === 'invites' ? ' on' : '')} onClick={() => setTab('invites')}>Приглашения</div>
          {!isVoice && <div className={'cset-tab' + (tab === 'integrations' ? ' on' : '')} onClick={() => setTab('integrations')}>Интеграция</div>}
          <div className="cset-sep" />
          <div className="cset-tab danger" onClick={del}>Удалить канал <Icon name="trash" size={15} /></div>
        </nav>
      </div>
      <div className="cset-main">
        {tab === 'overview' && <>
          <div className="cset-h">Обзор</div>
          <label className="cset-lbl">Название канала</label>
          <input className="modal-in" value={name} onChange={e => { setName(e.target.value); setDirty(true) }} />
          {!isVoice && <>
            <label className="cset-lbl">Тема канала</label>
            <textarea className="cset-topic" maxLength={1024} placeholder="Расскажите участникам, как пользоваться этим каналом!"
              value={topic} onChange={e => { setTopic(e.target.value); setDirty(true) }} />
            <div className="cset-count">{1024 - topic.length}</div>
          </>}
          <label className="cset-lbl">Медленный режим</label>
          <select className="modal-in" value={slow} onChange={e => { setSlow(e.target.value); setDirty(true) }}>{SLOW_OPTS.map(o => <option key={o}>{o}</option>)}</select>
          <div className="cset-hint">Участники не смогут отправлять больше одного сообщения и создавать больше одной ветки в течение этого периода времени, кроме случаев, когда у них есть право обходить медленный режим.</div>
          <div className="cset-row">
            <div>
              <div className="cset-row-t">Канал с возрастным ограничением</div>
              <div className="cset-hint">Для просмотра содержимого этого канала пользователям необходимо подтвердить, что они достигли совершеннолетия. В каналах с возрастными ограничениями отсутствует фильтр нежелательного контента.</div>
            </div>
            <button className={'tgl' + (nsfw ? ' on' : '')} onClick={() => { setNsfw(!nsfw); setDirty(true) }} />
          </div>
          {!isVoice && <>
            <label className="cset-lbl">Скрыть после неактивности</label>
            <select className="modal-in" value={hide} onChange={e => { setHide(e.target.value); setDirty(true) }}>{HIDE_OPTS.map(o => <option key={o}>{o}</option>)}</select>
            <div className="cset-hint">Новые ветки перестанут отображаться в списке каналов после заданного периода неактивности.</div>
          </>}
          {isVoice && <>
            <div className="cset-div" />
            <label className="cset-lbl">Битрейт</label>
            <div className="cset-scale"><span>8kbps</span><span>64kbps</span><span>96kbps</span></div>
            <input type="range" className="cset-slider" min={8} max={96} value={bitrate} onChange={e => { setBitrate(Number(e.target.value)); setDirty(true) }} />
            <div className="cset-hint">ВНИМАНИЕ! Не поднимайте битрейт выше 64 кбит/с, чтобы не создать проблемы людям с низкой скоростью соединения.</div>
            <label className="cset-lbl">Качество видео</label>
            <div className={'cset-radio' + (vq === 'auto' ? ' on' : '')} onClick={() => { setVq('auto'); setDirty(true) }}><span className="dot" /> Автоматически</div>
            <div className={'cset-radio' + (vq === '720p' ? ' on' : '')} onClick={() => { setVq('720p'); setDirty(true) }}><span className="dot" /> 720p</div>
            <div className="cset-hint">Устанавливает качество изображения для всех участников канала. Выберите <b>Автоматически</b> для оптимальной производительности.</div>
            <label className="cset-lbl">Лимит пользователей</label>
            <div className="cset-scale"><span>∞</span><span>99</span></div>
            <input type="range" className="cset-slider" min={0} max={99} value={limit} onChange={e => { setLimit(Number(e.target.value)); setDirty(true) }} />
            <div className="cset-hint">Ограничивает количество пользователей, которые могут подключаться к этому голосовому каналу. Пользователи с правом на <b>перемещение участников</b> могут игнорировать это ограничение и перемещать других пользователей в канал.</div>
            <label className="cset-lbl">Назначение региона</label>
            <select className="modal-in" value={region} onChange={e => { setRegion(e.target.value); setDirty(true) }}>{REGIONS.map(o => <option key={o}>{o}</option>)}</select>
            <div className="cset-hint">Для всех пользователей канала независимо от их местонахождения будет предпринята попытка подключения к указанному вами региону. От региона может зависеть качество видео и звука.</div>
          </>}
        </>}
        {tab === 'perms' && <>
          <div className="cset-h">Права канала</div>
          <div className="cset-hint" style={{ marginTop: -12, marginBottom: 14 }}>Используйте права, чтобы настроить возможности пользователей на этом канале.</div>
          <div className="cset-sync"><Icon name="repeat" size={16} /> Права синхронизированы с категорией «{isVoice ? 'Голосовые каналы' : 'Текстовые каналы'}»</div>
          <div className="cset-priv">
            <div><div className="cset-row-t">🔒 Приватный канал</div>
              <div className="cset-hint">Если сделать канал приватным, только выбранные вами участники и роли смогут просматривать его.</div></div>
            <button className={'tgl' + (priv ? ' on' : '')} onClick={() => { setPriv(!priv); setDirty(true) }} />
          </div>
          <div className="cset-div" />
          <div className="cset-h" style={{ fontSize: 17 }}>Расширенные права</div>
          <div className="cset-cat" style={{ padding: '0 0 6px' }}>Роли/Участники</div>
          <div className="cset-role-chip">@everyone</div>
          <label className="cset-lbl">Основные права канала</label>
          {MAIN_PERMS.map(p => <div key={p.k} className="cset-perm">
            <div className="cset-perm-h">{p.t} {tri(p.k)}</div>
            <div className="cset-hint">{p.d}</div>
          </div>)}
          <label className="cset-lbl">Права участников</label>
          {MEMBER_PERMS.map(p => <div key={p.k} className="cset-perm">
            <div className="cset-perm-h">{p.t} {tri(p.k)}</div>
            <div className="cset-hint">{p.d}</div>
          </div>)}
        </>}
        {tab === 'invites' && <>
          <div className="cset-h">Приглашения</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Вот список всех активных ссылок-приглашений. Вы можете отозвать любое или <a className="cset-link" onClick={makeInvite}>создать ещё</a>.</div>
          <div style={{ margin: '14px 0' }}>
            <button className={'cset-pause' + (paused ? ' off' : '')} onClick={() => { setPaused(!paused); setDirty(true) }}>{paused ? 'Возобновить приглашения' : 'Приостановить приглашения'}</button>
          </div>
          {invites.length === 0 && <div className="cset-inv-empty">
            <b>ПОКА НЕТ ПРИГЛАШЕНИЙ</b>
            Не видите перед собой цели? Вас несёт, словно бумажный самолётик, дрейфующий по небу? Пригласите сюда своих друзей, создав ссылку-приглашение!
          </div>}
          {invites.map(i => <div key={i.id} className="cset-inv">
            <code>{i.code}</code>
            <button className="cset-reset" style={{ color: '#ed4245' }} onClick={() => revoke(i.id)}>Отозвать</button>
          </div>)}
        </>}
        {tab === 'integrations' && !isVoice && <>
          <div className="cset-h">Интеграция</div>
          <div className="cset-hint" style={{ marginTop: -12 }}>Персонализируйте свой сервер с помощью интеграций. Управляйте вебхуками и отслеживаемыми каналами, публикации с которых появляются на этом канале.</div>
          <div className="cset-int">
            <Icon name="zap" size={22} />
            <div className="cset-int-t"><b>Вебхуки</b><span>0 вебхуков</span></div>
            <button onClick={() => toastOk('Вебхуки скоро появятся')}>Создать вебхук</button>
          </div>
          <div className="cset-int">
            <Icon name="repeat" size={22} />
            <div className="cset-int-t"><b>Отслеживаемые каналы</b><span>0 каналов</span></div>
          </div>
        </>}
      </div>
      <button className="cset-esc" onClick={onClose}>
        <span className="cset-esc-circle"><Icon name="close" size={16} /></span>
        ESC
      </button>
      {dirty && <div className="cset-savebar">
        <span>Осторожно — вы не сохранили изменения!</span>
        <button className="cset-reset" onClick={reset}>Сбросить</button>
        <button className="cset-save" onClick={save}>Сохранить изменения</button>
      </div>}
    </div>,
    document.body
  )
}