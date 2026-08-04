// v1.452.0: панель прохождения сюжетной игры — открыть и посмотреть всё.
//
// Устроена как статистика CS2 (GameStatsModal): открывается по нажатию на
// активность, показывает не одну строку, а всю картину — полосу процентов,
// список миссий с отметками, текущую отдельно и свои заметки внизу.
//
// Данные не выдумываются: список миссий вставляет человек, отметки ставит он же
// (см. lib/campaign.ts — там же сказано, почему автоматического источника для
// одиночных игр не существует). Приложение считает и показывает.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk } from '../lib/toast'
import { loadAi, askAi, aiReady } from '../lib/gameAi'
import { CampaignFlow } from './CampaignFlow'
import { flowProgress, type FlowNode, type Placed } from '../lib/flow'
import { copyText } from '../lib/copyMedia'
import {
  loadCampaign, saveCampaign, forgetCampaign, buildCampaign, toggleMission, setNote,
  counts, percent, currentIndex, isComplete, fullLabel, askPrompt,
  autoNodes, nodesFromCampaign, AUTO_WHY, MAX_MISSIONS, type Campaign, type AutoWhy,
} from '../lib/campaign'

export function CampaignModal({ game, isMe, steamId, appId, onClose }: {
  game: string; isMe: boolean; steamId?: string | null; appId?: string | null; onClose: () => void
}) {
  const [c, setC] = useState<Campaign | null>(() => loadCampaign(game))
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => (loadCampaign(game)?.missions ?? []).map(m => m.name).join('\n'))
  const [pick, setPick] = useState<number | null>(null)
  const [q, setQ] = useState('')
  // v1.453.0: ответ ИИ прямо здесь. Ключ свой, лежит на устройстве (lib/gameAi.ts).
  const [ai] = useState(() => loadAi())
  const [ответ, setОтвет] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // v1.458.0: вехи приложение узнаёт САМО — из Steam, по профилю человека.
  // Ручной список остался запасным путём: для игр не из Steam и закрытого профиля.
  const [auto, setAuto] = useState<{ nodes: FlowNode[]; why?: AutoWhy } | null>(null)
  const [ищем, setИщем] = useState(true)
  const [узел, setУзел] = useState<Placed | null>(null)

  useEffect(() => {
    let жив = true
    autoNodes(steamId ?? null, appId ?? null).then(r => {
      if (!жив) return
      setAuto({ nodes: r.nodes, why: r.why })
      setИщем(false)
    })
    return () => { жив = false }
  }, [game, steamId, appId])

  async function спросить() {
    if (busy || !q.trim()) return
    setBusy(true); setОтвет(''); setErr('')
    try {
      let acc = ''
      await askAi(ai, askPrompt(c, q), piece => { acc += piece; setОтвет(acc) })
      if (!acc) setErr('Сервис ответил пустотой — попробуй ещё раз или другую модель')
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally { setBusy(false) }
  }

  // Что показываем: вехи из Steam, если они есть, иначе ручной список.
  const авто = !!auto?.nodes.length
  const узлы: FlowNode[] = авто ? auto!.nodes : nodesFromCampaign(c)
  const прогресс = flowProgress(узлы)

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
        <div className="cmp-sub">{прогресс.total > 0
          ? `Пройдено ${прогресс.done} из ${прогресс.total} · ${прогресс.pct}%`
          : (auto?.why ? AUTO_WHY[auto.why] : 'Прохождение ещё не заведено')}</div>

        {прогресс.total > 0 && (
          <div className="cmp-bar" title={`${прогресс.done} из ${прогресс.total}`}>
            <div className={'cmp-bar-fill' + (прогресс.pct >= 100 ? ' full' : '')} style={{ width: прогресс.pct + '%' }} />
            <span className="cmp-bar-tx">{прогресс.pct}%</span>
          </div>
        )}

        {ищем ? <div className="cmp-load">Смотрю, где ты сейчас…</div>
          : (editing || (!авто && !c)) ? <>
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
          {/* Схема, а не список строк: пройденное позади, текущее выделено,
              дальнейшее приглушено — как читают карту прохождения. */}
          <CampaignFlow nodes={узлы} picked={узел?.id ?? null} onPick={n => {
            setУзел(n)
            // Отмечать можно только ручной список: вехи Steam отмечает сама игра,
            // и врать про них галочкой нельзя.
            if (!авто && isMe) сохранить(toggleMission(c!, n.step))
          }} />
          {!авто && <div className="cset-hint">Нажатие по вехе отмечает её пройденной — и всё, что до неё.</div>}
          {авто && <div className="cset-hint">
            Вехи и отметки берутся из твоего профиля Steam — отмечать вручную ничего не нужно.
          </div>}

          {/* Советы внизу — свои заметки к выбранной миссии. Приложение их не
              сочиняет: подсказка, написанная приложением от себя, была бы
              выдумкой ровно там, где человек ждёт точности. */}
          <div className="cmp-note">
            <label className="modal-lbl">
              {узел ? `«${узел.title}»` : миссия ? `Заметки к «${миссия.name}»` : 'Заметки'}
            </label>
            {узел?.desc && <div className="cmp-desc">{узел.desc}</div>}
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
                placeholder="Например: где найти ключ от ворот?"
                onKeyDown={e => { if (e.key === 'Enter' && q.trim() && !busy) void спросить() }} />
              {aiReady(ai)
                ? <button className="pqs2-btn" disabled={!q.trim() || busy} onClick={() => void спросить()}>
                    {busy ? 'Спрашиваю…' : 'Спросить'}
                  </button>
                : <button className="pqs2-btn" disabled={!q.trim()}
                    onClick={() => { copyText(askPrompt(c, q), 'Вопрос вместе с местом прохождения скопирован') }}>
                    Скопировать вопрос
                  </button>}
            </div>
            {/* Ответ приходит по словам — ждать минуту, глядя в пустоту, незачем. */}
            {(ответ || err) && <div className={'cmp-answer' + (err ? ' bad' : '')}>{err || ответ}</div>}
            <div className="cset-hint">
              К вопросу прикладывается, где ты сейчас: игра, миссия и проценты, — и просьба не
              рассказывать сюжет вперёд. {aiReady(ai)
                ? 'Отвечает ' + (ai.provider === 'anthropic' ? 'Anthropic' : 'OpenAI') + ' по твоему ключу — он лежит только на этом устройстве.'
                : 'Свой ключ ИИ задаётся в Настройках → Активность; без него вопрос просто копируется, чтобы вставить куда угодно.'}
            </div>
          </div>

          {isMe && !авто && <div className="modal-foot">
            <button className="modal-ghost danger" onClick={() => { forgetCampaign(game); setC(null); setText(''); setEditing(true) }}>Забыть прохождение</button>
            <button className="modal-ghost" onClick={() => { setText(строки.map(m => m.name).join('\n')); setEditing(true) }}>Править список</button>
          </div>}
        </>}
      </div>
    </div></Portal>
  )
}
