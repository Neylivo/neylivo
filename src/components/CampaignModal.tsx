// v1.452.0: панель прохождения сюжетной игры — открыть и посмотреть всё.
//
// Устроена как статистика CS2 (GameStatsModal): открывается по нажатию на
// активность, показывает не одну строку, а всю картину — полосу процентов,
// список миссий с отметками, текущую отдельно и свои заметки внизу.
//
// Данные не выдумываются: список миссий вставляет человек, отметки ставит он же
// (см. lib/campaign.ts — там же сказано, почему автоматического источника для
// одиночных игр не существует). Приложение считает и показывает.
import { useMemo, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk } from '../lib/toast'
import { copyText } from '../lib/copyMedia'
import {
  loadCampaign, saveCampaign, forgetCampaign, buildCampaign, toggleMission, setNote,
  counts, percent, currentIndex, isComplete, fullLabel, askPrompt,
  MAX_MISSIONS, type Campaign,
} from '../lib/campaign'

export function CampaignModal({ game, isMe, onClose }: { game: string; isMe: boolean; onClose: () => void }) {
  const [c, setC] = useState<Campaign | null>(() => loadCampaign(game))
  const [editing, setEditing] = useState(() => !loadCampaign(game))
  const [text, setText] = useState(() => (loadCampaign(game)?.missions ?? []).map(m => m.name).join('\n'))
  const [pick, setPick] = useState<number | null>(null)
  const [q, setQ] = useState('')

  const { done, total } = counts(c)
  const pct = percent(c)
  const cur = currentIndex(c)
  const выбрана = pick ?? (cur >= 0 ? cur : total - 1)
  const миссия = выбрана >= 0 ? c?.missions[выбрана] : undefined

  // Пересчитывается только при правке списка: у длинной кампании это пять сотен
  // строк, а панель перерисовывается на каждое нажатие.
  const строки = useMemo(() => c?.missions ?? [], [c])

  const сохранить = (next: Campaign) => { setC(next); saveCampaign(next) }

  function применитьСписок() {
    const next = buildCampaign(game, text, c)
    if (next.missions.length === 0) { setEditing(true); return }
    сохранить(next)
    setEditing(false)
    toastOk(`Список сохранён: ${next.missions.length} миссий`)
  }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal cmp" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title" style={{ margin: 0 }}>{game}</div>
        <div className="cmp-sub">{total > 0 ? fullLabel(c) : 'Прохождение ещё не заведено'}</div>

        {total > 0 && (
          <div className="cmp-bar" title={`${done} из ${total}`}>
            <div className={'cmp-bar-fill' + (isComplete(c) ? ' full' : '')} style={{ width: pct + '%' }} />
            <span className="cmp-bar-tx">{pct}%</span>
          </div>
        )}

        {editing ? <>
          <label className="modal-lbl">Список миссий — по одной в строке</label>
          <div className="cset-hint" style={{ marginBottom: 8 }}>
            Вставь список из вики или из меню игры. Нумерация и маркеры («1.», «-», «•») отбросятся сами,
            повторы уберутся. Приложение не придумывает миссии за тебя: любой встроенный список был бы
            написан по памяти, а значит с ошибками. До {MAX_MISSIONS} строк.
          </div>
          <textarea className="modal-in cmp-paste" value={text} onChange={e => setText(e.target.value)}
            placeholder={'Пролог\n1. Побег из деревни\n2. Дорога на север\n…'} />
          <div className="modal-foot">
            {c && <button className="modal-ghost" onClick={() => { setEditing(false); setText(строки.map(m => m.name).join('\n')) }}>Отмена</button>}
            <button className="modal-primary" onClick={применитьСписок}>Сохранить список</button>
          </div>
        </> : <>
          <div className="cmp-list">
            {строки.map((m, i) => (
              <div key={i} className={'cmp-row' + (m.done ? ' done' : '') + (i === cur ? ' cur' : '') + (i === выбрана ? ' sel' : '')}
                onClick={() => setPick(i)}>
                <button className={'cmp-tick' + (m.done ? ' on' : '')} title={m.done ? 'Снять отметку' : 'Отметить пройденной'}
                  onClick={e => { e.stopPropagation(); if (isMe) сохранить(toggleMission(c!, i)) }}
                  disabled={!isMe}>
                  {m.done ? <Icon name="check" size={13} /> : null}
                </button>
                <span className="cmp-num">{i + 1}</span>
                <span className="cmp-nm">{m.name}</span>
                {i === cur && <span className="cmp-here">сейчас здесь</span>}
                {m.note && <Icon name="edit" size={12} />}
              </div>
            ))}
          </div>

          {/* Советы внизу — свои заметки к выбранной миссии. Приложение их не
              сочиняет: подсказка, написанная приложением от себя, была бы
              выдумкой ровно там, где человек ждёт точности. */}
          <div className="cmp-note">
            <label className="modal-lbl">
              {миссия ? `Заметки к миссии «${миссия.name}»` : 'Заметки'}
            </label>
            {isMe ? (
              <textarea className="modal-in" rows={3} value={миссия?.note ?? ''}
                placeholder="Что помогло, куда идти, где спрятан ключ — это увидишь только ты"
                onChange={e => сохранить(setNote(c!, выбрана, e.target.value))} />
            ) : (
              <div className="cset-hint">{миссия?.note || 'Заметок нет.'}</div>
            )}
          </div>

          {/* Спросить ИИ — вопрос уходит вместе с местом прохождения. Сам ответ
              даёт плагин с ИИ-моделью (ponoi.net.stream): своей модели в
              приложении нет, и делать вид, что есть, нельзя. */}
          <div className="cmp-ask">
            <label className="modal-lbl">Спросить про это место</label>
            <div className="cmp-ask-row">
              <input className="modal-in" value={q} onChange={e => setQ(e.target.value)}
                placeholder="Например: где найти ключ от ворот?" />
              <button className="pqs2-btn" disabled={!q.trim()}
                onClick={() => { copyText(askPrompt(c, q), 'Вопрос вместе с местом прохождения скопирован') }}>
                Скопировать вопрос
              </button>
            </div>
            <div className="cset-hint">
              К вопросу прикладывается, где ты сейчас: игра, миссия и проценты, — и просьба не
              рассказывать сюжет вперёд. Вставь это в любой ИИ или в плагин с моделью.
            </div>
          </div>

          {isMe && <div className="modal-foot">
            <button className="modal-ghost danger" onClick={() => { forgetCampaign(game); setC(null); setText(''); setEditing(true) }}>Забыть прохождение</button>
            <button className="modal-ghost" onClick={() => { setText(строки.map(m => m.name).join('\n')); setEditing(true) }}>Править список</button>
          </div>}
        </>}
      </div>
    </div></Portal>
  )
}
