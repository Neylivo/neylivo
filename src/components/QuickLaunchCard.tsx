import { useState } from 'react'
import { toastErr } from '../lib/toast'
import { fetchPack, prepareInstance, launchPack, onMcProgress, isQuicklaunchAvailable, type QlProgress } from '../lib/quicklaunch'

// v1.180.0: кнопка «Скачать и войти» карточки «Игровой Экспресс» — докачивает
// недостающие моды в песочницу и запускает игру уже подключённой к серверу
// хоста (см. src/lib/quicklaunch.ts + electron/quicklaunch.cjs).
type Stage = 'idle' | 'fetching' | 'installer' | 'mods' | 'libraries' | 'assets' | 'launching' | 'done' | 'error'

const STAGE_LABEL: Record<Stage, string> = {
  idle: 'Скачать и войти', fetching: 'Загружаю список модов…', installer: 'Устанавливаю загрузчик модов…',
  mods: 'Докачиваю моды…', libraries: 'Докачиваю библиотеки игры…', assets: 'Докачиваю ресурсы…',
  launching: 'Запускаю игру…', done: 'Готово — заходи в игру!', error: 'Повторить',
}

export function QuickLaunchCard({ packId, username }: { packId: string; username: string }) {
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = stage !== 'idle' && stage !== 'done' && stage !== 'error'

  async function start() {
    if (!isQuicklaunchAvailable()) { toastErr('Игровой Экспресс работает только в приложении для компьютера'); return }
    setError(null); setProgress(null); setStage('fetching')
    try {
      const pack = await fetchPack(packId)
      if (!pack) throw new Error('Сборка не найдена — возможно, её удалили')
      setStage('mods')
      onMcProgress((p: QlProgress) => {
        if (p.stage) setStage(p.stage === 'launch' ? 'launching' : p.stage)
        setProgress(p.done !== undefined && p.total !== undefined ? { done: p.done, total: p.total } : null)
      })
      const { instanceDir } = await prepareInstance(pack)
      setStage('launching'); setProgress(null)
      await launchPack(pack, instanceDir, username)
      setStage('done')
      setTimeout(() => setStage('idle'), 6000)
    } catch (err: any) {
      setError(err.message ?? String(err))
      setStage('error')
    }
  }

  return (
    <>
      <button className="inv2-join ql-btn" disabled={busy} onClick={start}>{STAGE_LABEL[stage]}</button>
      {busy && progress && progress.total > 0 && <div className="ql-progress">
        <div className="ql-progress-fill" style={{ width: Math.round(progress.done / progress.total * 100) + '%' }} />
      </div>}
      {error && <div className="ql-error">{error}</div>}
    </>
  )
}
