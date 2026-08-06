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
import { useBackClose } from '../lib/mobileBack'
import { toastOk } from '../lib/toast'
import { loadAi, askAi, aiReady } from '../lib/gameAi'
import { CampaignFlow } from './CampaignFlow'
import { flowProgress, flowPrompt, type FlowNode, type Placed } from '../lib/flow'
import { copyText } from '../lib/copyMedia'
import {
  loadCampaign, saveCampaign, forgetCampaign, buildCampaign, toggleMission, setNote, shareLabel, type StoryShare,
  counts, percent, currentIndex, isComplete, fullLabel, askPrompt,
  autoNodes, nodesFromCampaign, AUTO_WHY, MAX_MISSIONS, playedLabel, sizeLabel,
  type Campaign, type AutoWhy, type GameFacts,
} from '../lib/campaign'

export function CampaignModal({ game, isMe, steamId, appId, shared, onClose }: {
  game: string; isMe: boolean; steamId?: string | null; appId?: string | null
  /**
   * v1.505.0: чужое прохождение — ровно то, чем человек делится.
   *
   * Без этого панель для чужой активности читала МОИ вехи с МОЕГО диска и мою
   * же память приложения, а показывала их под чужим именем. Выглядело
   * убедительно и было выдумкой: у меня та же игра пройдена на 40%, у него на
   * 90%, а на экране моё.
   *
   * Поэтому здесь другое: когда shared задан, с диска ничего не читается
   * вообще, и панель показывает те числа, что пришли в присутствии.
   */
  shared?: StoryShare | null
  onClose: () => void
}) {
  const [c, setC] = useState<Campaign | null>(() => loadCampaign(game))
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
  const [auto, setAuto] = useState<{ nodes: FlowNode[]; why?: AutoWhy; facts?: GameFacts | null } | null>(null)
  const [ищем, setИщем] = useState(true)
  const [узел, setУзел] = useState<Placed | null>(null)
  // v1.505.0: «назад» на телефоне закрывает ПАНЕЛЬ, а не то, из чего её открыли.
  // Панель рисуется порталом — вне дерева мини-профиля, и без своей записи в
  // стеке нажатие «назад» снимало бы мини-профиль, унося панель вместе с ним.
  useBackClose(true, onClose)

  useEffect(() => {
    let жив = true
    // Чужое прохождение с моего диска не читается: там лежит МОЁ.
    if (shared !== undefined) { setAuto({ nodes: [] }); setИщем(false); return }
    autoNodes(steamId ?? null, appId ?? null).then(r => {
      if (!жив) return
      setAuto({ nodes: r.nodes, why: r.why, facts: r.facts ?? null })
      setИщем(false)
    })
    return () => { жив = false }
  }, [game, steamId, appId])

  // Что показываем: вехи из Steam, если они есть, иначе ручной список.
  const авто = !!auto?.nodes.length
  const узлы: FlowNode[] = авто ? auto!.nodes : nodesFromCampaign(c)
  const прогресс = flowProgress(узлы)

  async function спросить() {
    if (busy || !q.trim()) return
    setBusy(true); setОтвет(''); setErr('')
    try {
      let acc = ''
      await askAi(ai, flowPrompt(game, узлы, q), piece => { acc += piece; setОтвет(acc) })
      if (!acc) setErr('Сервис ответил пустотой — попробуй ещё раз или другую модель')
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally { setBusy(false) }
  }

  const { done, total } = counts(c)
  const pct = percent(c)
  const cur = currentIndex(c)
  const выбрана = pick ?? (cur >= 0 ? cur : total - 1)
  const миссия = выбрана >= 0 ? c?.missions[выбрана] : undefined

  // Пересчитывается только при правке списка: у длинной кампании это пять сотен
  // строк, а панель перерисовывается на каждое нажатие.
  const строки = useMemo(() => c?.missions ?? [], [c])

  const сохранить = (next: Campaign) => { setC(next); saveCampaign(next) }


  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal cmp" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title" style={{ margin: 0 }}>{game}</div>
        {shared !== undefined ? <>
          {/* Чужое: показываем ровно то, чем поделились, и говорим это словами.
              Ни отметок, ни заметок, ни чтения диска здесь нет. */}
          <div className="cmp-sub">{shared ? shareLabel(shared) : 'Игрок не делится своим местом в игре'}</div>
          {shared && shared.total > 0 && <>
            <div className="cmp-bar" title={shared.done + ' из ' + shared.total}>
              <div className={'cmp-bar-fill' + (shared.pct >= 100 ? ' full' : '')} style={{ width: shared.pct + '%' }} />
              <span className="cmp-bar-tx">{shared.pct}%</span>
            </div>
            {!!shared.mission && <div className="cmp-note">
              <label className="modal-lbl">Сейчас проходит</label>
              <div className="cmp-desc">{shared.mission}</div>
            </div>}
          </>}
        </> : <>
        <div className="cmp-sub">{прогресс.total > 0
          ? `Пройдено ${прогресс.done} из ${прогресс.total} · ${прогресс.pct}%`
          : (auto?.why ? AUTO_WHY[auto.why] : 'Прохождение ещё не заведено')}</div>
        {/* v1.505.0: то, что известно про саму игру. Лежит на диске и раньше не
            показывалось нигде: панель выглядела пустой у игры, в которую
            наиграно полторы сотни часов. */}
        {(() => {
          const f = auto?.facts
          if (!f) return null
          const части = [
            playedLabel(f.minutes) && 'Наиграно ' + playedLabel(f.minutes),
            f.lastPlayed ? 'последний запуск ' + new Date(f.lastPlayed * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
            sizeLabel(f.sizeBytes),
          ].filter(Boolean)
          if (!части.length) return null
          return <div className="cmp-facts" title={f.dir ?? undefined}>{части.join(' · ')}</div>
        })()}

        {прогресс.total > 0 && (
          <div className="cmp-bar" title={`${прогресс.done} из ${прогресс.total}`}>
            <div className={'cmp-bar-fill' + (прогресс.pct >= 100 ? ' full' : '')} style={{ width: прогресс.pct + '%' }} />
            <span className="cmp-bar-tx">{прогресс.pct}%</span>
          </div>
        )}

        {/* v1.461.0: поля «вставь список миссий» больше нет — по прямому
            указанию владельца. Вбивать прохождение руками это работа, а не
            удобство; приложение узнаёт вехи само (см. lib/campaign.ts). Если
            узнать неоткуда — честно говорим почему, а не подсовываем работу. */}
        {ищем ? <div className="cmp-load">Смотрю, где ты сейчас…</div>
          : узлы.length === 0 ? <div className="cmp-load">
              {auto?.why ? AUTO_WHY[auto.why] : 'Про эту игру приложению пока нечего показать.'}
            </div>
          : <>
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
                    onClick={() => { copyText(flowPrompt(game, узлы, q), 'Вопрос вместе с местом прохождения скопирован') }}>
                    Скопировать вопрос
                  </button>}
            </div>
            {/* Ответ приходит по словам — ждать минуту, глядя в пустоту, незачем. */}
            {(ответ || err) && <div className={'cmp-answer' + (err ? ' bad' : '')}>{err || ответ}</div>}
            <div className="cset-hint">
              К вопросу прикладывается, где ты сейчас: игра, миссия и проценты, — и просьба не
              рассказывать сюжет вперёд. {aiReady(ai)
                ? 'Отвечает ' + (ai.provider === 'gemini' ? 'Gemini' : ai.provider === 'anthropic' ? 'Anthropic' : 'OpenAI') + ' по твоему ключу — он лежит только на этом устройстве.'
                : 'Свой ключ ИИ задаётся в Настройках → Активность; без него вопрос просто копируется, чтобы вставить куда угодно.'}
            </div>
          </div>


        </>}
        </>}
      </div>
    </div></Portal>
  )
}
