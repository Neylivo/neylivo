import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk, toastErr } from '../lib/toast'
import { useAuth } from '../auth/AuthProvider'
import { parsePlugin } from '../lib/plugins/manifest'
import { installPlugin } from '../lib/plugins/install'
import { getPlugin } from '../lib/plugins/store'
import { pluginError, isRunning } from '../lib/plugins/host'
import { ALL_PERMISSIONS, PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type Permission } from '../lib/plugins/types'
import { publishPlugin, shorten, SUMMARY_MAX } from '../lib/catalog'
import {
  TEMPLATES, buildFile, draftFrom, draftFromTemplate, slugify, type Draft,
} from '../lib/plugins/editorDraft'
import { RECIPES, recipeDefaults, recipeReady, type Recipe } from '../lib/plugins/recipes'

// v1.336.0: конструктор плагина.
//
// До этого «сделать свой плагин» означало: открыть блокнот, вспомнить формат
// шапки, не ошибиться ни в одном поле, сохранить файл с нужным расширением и
// только потом ставить. Формат был описан в справке, но написать по нему без
// ошибок с первого раза почти невозможно — и человек не узнавал о промахе, пока
// не получал отказ при установке.
//
// Здесь шапку пишет форма, а человек пишет только тело — то, ради чего он и
// пришёл. Разрешения отмечаются галочками, готовые заготовки дают рабочий код
// с первой секунды, а ошибки видно сразу, ещё до установки.

export function PluginEditor({ editId, onClose, onSaved }: {
  editId?: string
  onClose: () => void
  onSaved?: () => void
}) {
  const { user } = useAuth()
  const author = (localStorage.getItem('ponoi_username') || user?.email?.split('@')[0] || 'я').slice(0, 40)
  const existing = editId ? getPlugin(editId) : undefined

  const [d, setD] = useState<Draft>(() => {
    const from = existing && draftFrom(existing.code)
    if (from) return from
    return draftFromTemplate(TEMPLATES[0])
  })
  const [tpl, setTpl] = useState(existing ? '' : 'command')
  // v1.344.0: два режима. «Без кода» — выбрал, что делать, заполнил пару полей
  // обычными словами, код собрался сам. Готовый плагин открывается сразу в
  // режиме кода: его тело мы не разбираем обратно в поля и делать вид, что
  // разобрали, не станем.
  const [mode, setMode] = useState<'easy' | 'code'>(existing ? 'code' : 'easy')
  const [recipe, setRecipe] = useState<Recipe>(RECIPES[0])
  const [rv, setRv] = useState<Record<string, string>>(() => recipeDefaults(RECIPES[0]))

  function pickRecipe(r: Recipe) {
    setRecipe(r)
    setRv(recipeDefaults(r))
    setRan(null)
  }

  // Пока человек в простом режиме, тело и разрешения плагина держим собранными
  // из рецепта: перейдя в «Код», он увидит ровно то, что получилось.
  useEffect(() => {
    if (mode !== 'easy') return
    setD(p => ({ ...p, permissions: [...recipe.permissions], body: recipe.build(rv) }))
  }, [mode, recipe, rv])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState<string | null>(null)
  // Установлен ли он уже — от этого зависит, можно ли предлагать «выложить».
  const [installed, setInstalled] = useState(!!existing)
  const [publishing, setPublishing] = useState(false)
  const idTouched = useRef(!!existing)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(p => ({ ...p, [k]: v }))

  // Идентификатор подставляется из названия, пока его не правили руками.
  useEffect(() => {
    if (!idTouched.current) setD(p => ({ ...p, id: slugify(p.name) }))
  }, [d.name])

  const file = useMemo(() => buildFile(d, author), [d, author])
  // Разбор на каждый ввод: ошибку видно сразу, а не после нажатия «Установить».
  const problem = useMemo(() => {
    try { parsePlugin(file); return null } catch (e: any) { return e?.message ?? String(e) }
  }, [file])

  function applyTemplate(key: string) {
    const t = TEMPLATES.find(x => x.key === key)
    if (!t) return
    setTpl(key)
    setD(p => ({ ...p, permissions: [...t.permissions], body: t.body }))
    setRan(null)
  }

  function togglePerm(p: Permission) {
    setD(prev => ({
      ...prev,
      permissions: prev.permissions.includes(p) ? prev.permissions.filter(x => x !== p) : [...prev.permissions, p],
    }))
  }

  /**
   * «Проверить» — настоящий запуск в песочнице, а не разбор шапки.
   *
   * Запустить плагин можно только установив его: песочница берёт код из списка
   * установленных. Значит после проверки он там и останется — и об этом надо
   * сказать прямо, а не оставить человека думать, что он «просто посмотрел».
   */
  async function tryRun() {
    if (problem) { toastErr(problem); return }
    setBusy(true); setRan(null)
    try {
      const m = parsePlugin(file)
      await installPlugin(m, file)
      const err = pluginError(m.id)
      if (err) { setRan('Не запустился: ' + err + ' (плагин установлен — можно править и проверять снова)'); setInstalled(true) }
      else if (isRunning(m.id)) { setRan('Запустился и работает — плагин уже установлен.'); setInstalled(true) }
      else { setRan('Установлен, но не запущен — включи его во вкладке «Используемые».'); setInstalled(true) }
      onSaved?.()
    } catch (e: any) {
      setRan('Не запустился: ' + (e?.message ?? String(e)))
    } finally { setBusy(false) }
  }

  async function save() {
    if (problem) { toastErr(problem); return }
    setBusy(true)
    try {
      const m = parsePlugin(file)
      await installPlugin(m, file)
      toastOk(existing ? `Плагин «${m.name}» обновлён` : `Плагин «${m.name}» установлен`)
      onSaved?.()
      onClose()
    } catch (e: any) {
      toastErr('Установлен, но не запустился: ' + (e?.message ?? String(e)))
      onSaved?.()
    } finally { setBusy(false) }
  }

  /** Выложить в каталог, не уходя из конструктора. */
  async function publish() {
    if (problem || !user) { toastErr(problem ?? 'Нужно войти'); return }
    setBusy(true)
    try {
      const m = parsePlugin(file)
      await installPlugin(m, file)          // в каталог уходит ровно то, что работает
      setInstalled(true)
      await publishPlugin({
        id: m.id, name: m.name, version: m.version,
        summary: shorten(m.description || m.name, SUMMARY_MAX),
        description: m.description, icon_url: null, banner_url: null,
        code: file, permissions: m.permissions,
      }, user.id)
      toastOk('Плагин в каталоге — картинку и описание можно добавить там же')
      setPublishing(false)
      onSaved?.()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  function download() {
    const blob = new Blob([file], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (d.id || 'plugin') + '.ponoi'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  return (
    <Portal><div className="modal-overlay" onClick={onClose}>
      <div className="modal ped-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="modal-title">{existing ? 'Изменить плагин' : 'Новый плагин'}</div>
        <div className="modal-sub">
          {existing ? 'Правь код — шапку файла форма перепишет сама.'
            : mode === 'easy'
              ? 'Выбери, что он должен делать, и заполни пару полей. Писать код не нужно.'
              : 'Шапку файла напишет форма — тебе остаётся только код.'}
        </div>

        {!existing && (
          <div className="ped-modes">
            <button className={'ped-mode' + (mode === 'easy' ? ' on' : '')} onClick={() => setMode('easy')}>
              Без кода
            </button>
            <button className={'ped-mode' + (mode === 'code' ? ' on' : '')} onClick={() => setMode('code')}>
              Код
            </button>
          </div>
        )}

        {!existing && mode === 'easy' && <>
          <label className="modal-lbl">Что должен делать плагин</label>
          <div className="ped-tpls">
            {RECIPES.map(r => (
              <button key={r.key} className={'ped-tpl' + (recipe.key === r.key ? ' on' : '')} title={r.hint}
                onClick={() => pickRecipe(r)}>
                <span className="ped-tpl-e">{r.emoji}</span>
                <span className="ped-tpl-l">{r.label}</span>
              </button>
            ))}
          </div>
          <div className="cset-hint" style={{ marginTop: 6 }}>{recipe.hint}</div>

          {recipe.fields.map(f => (
            <div key={f.key}>
              <label className="modal-lbl">{f.label}</label>
              {f.color
                ? <input type="color" className="ped-color" value={rv[f.key] ?? '#5865f2'}
                    onChange={e => setRv(v => ({ ...v, [f.key]: e.target.value }))} />
                : f.multiline
                  ? <textarea className="cset-topic" maxLength={1500} placeholder={f.placeholder}
                      value={rv[f.key] ?? ''} onChange={e => setRv(v => ({ ...v, [f.key]: e.target.value }))} />
                  : <input className="modal-in" placeholder={f.placeholder} value={rv[f.key] ?? ''}
                      onChange={e => setRv(v => ({ ...v, [f.key]: e.target.value }))} />}
            </div>
          ))}
          {!recipeReady(recipe, rv) && <div className="cset-hint" style={{ marginTop: 6 }}>Заполни поля выше — иначе плагин ничего не сделает.</div>}
        </>}

        {!existing && mode === 'code' && <>
          <label className="modal-lbl">С чего начать</label>
          <div className="ped-tpls">
            {TEMPLATES.map(t => (
              <button key={t.key} className={'ped-tpl' + (tpl === t.key ? ' on' : '')} title={t.hint}
                onClick={() => applyTemplate(t.key)}>
                <span className="ped-tpl-e">{t.emoji}</span>
                <span className="ped-tpl-l">{t.label}</span>
              </button>
            ))}
          </div>
        </>}

        <div className="ped-row">
          <div>
            <label className="modal-lbl">Название</label>
            <input className="modal-in" value={d.name} onChange={e => set('name', e.target.value)} placeholder="Мой плагин" autoFocus />
          </div>
          <div>
            <label className="modal-lbl">Версия</label>
            <input className="modal-in" value={d.version} onChange={e => set('version', e.target.value)} placeholder="1.0.0" />
          </div>
        </div>

        {mode === 'code' && <>
        <label className="modal-lbl">Идентификатор</label>
        <input className="modal-in" value={d.id} disabled={!!existing}
          onChange={e => { idTouched.current = true; set('id', e.target.value.toLowerCase()) }} placeholder="my-plugin" />
        <div className="cset-hint" style={{ marginTop: 4 }}>
          {existing
            ? 'У готового плагина идентификатор не меняется — по нему он и обновляется.'
            : 'Подставляется из названия. По нему плагин обновляется, поэтому должен быть уникальным.'}
        </div>

        </>}

        <label className="modal-lbl">Описание</label>
        <input className="modal-in" value={d.description} onChange={e => set('description', e.target.value)}
          placeholder="Одной строкой: что он делает" />

        {mode === 'easy' && (
          <div className="ped-perm-note">
            Плагин попросит только то, без чего не заработает:{' '}
            {recipe.permissions.map(p => PERMISSION_LABEL[p]).join(', ').toLowerCase() || 'ничего'}.
          </div>
        )}

        {mode === 'code' && <>
        <label className="modal-lbl">Что плагину разрешено</label>
        <div className="ped-perms">
          {ALL_PERMISSIONS.map(p => (
            <label key={p} className={'ped-perm' + (d.permissions.includes(p) ? ' on' : '') + (SENSITIVE_PERMISSIONS.includes(p) ? ' warn' : '')}>
              <input type="checkbox" checked={d.permissions.includes(p)} onChange={() => togglePerm(p)} />
              <span>{PERMISSION_LABEL[p]}</span>
            </label>
          ))}
        </div>
        {d.permissions.includes('net') && <>
          <label className="modal-lbl">Сайты, куда можно ходить</label>
          <input className="modal-in" value={d.hosts} onChange={e => set('hosts', e.target.value)}
            placeholder="example.com, api.example.com" />
        </>}

        <label className="modal-lbl">Код</label>
        <textarea className="ped-code" spellCheck={false} value={d.body} onChange={e => set('body', e.target.value)}
          placeholder="function onLoad(ponoi) { … }" />
        <div className="cset-hint" style={{ marginTop: 4 }}>
          Функция <code>onLoad</code> получает объект <code>ponoi</code> — через него плагин и работает.
          Полный список того, что он умеет, — в справке «?» рядом с заголовком раздела.
        </div>
        </>}

        <div className={'ped-status' + (problem ? ' bad' : '')}>
          {problem
            ? <><Icon name="flag" size={14} /> {problem}</>
            : <><Icon name="check" size={14} /> Шапка в порядке{ran ? ' · ' + ran : ''}</>}
        </div>

        {/* Следующий шаг предлагается здесь же: раньше «выложить» жило в другом
            окне, и надо было догадаться, что сперва плагин нужно установить. */}
        {installed && !publishing && (
          <button className="pqs2-btn ghost" style={{ marginTop: 10 }} onClick={() => setPublishing(true)}>
            <Icon name="store" size={15} /> Выложить в каталог
          </button>
        )}
        {publishing && (
          <div className="ped-publish">
            <div>Выложить «{d.name || 'плагин'}» в каталог? Его увидят и смогут поставить все.
              Уйдёт и код — иначе поставить его было бы нельзя.</div>
            <div className="modal-inline" style={{ marginTop: 8 }}>
              <button className="pqs2-btn ghost" onClick={() => setPublishing(false)}>Отмена</button>
              <button className="pqs2-btn" disabled={busy} onClick={() => void publish()}>
                {busy ? 'Выкладываю…' : 'Выложить'}
              </button>
            </div>
          </div>
        )}

        <div className="modal-foot ped-foot">
          <button className="modal-ghost" onClick={download} title="Сохранить как .ponoi-файл">
            <Icon name="download" size={15} /> Файл
          </button>
          {mode === 'code' && (
            <button className="modal-ghost" disabled={busy || !!problem} onClick={() => void tryRun()}
              title="Поставит плагин и запустит — иначе проверить его нельзя">
              {busy ? '…' : 'Проверить'}
            </button>
          )}
          <button className="modal-primary"
            disabled={busy || !!problem || (mode === 'easy' && !recipeReady(recipe, rv))}
            onClick={() => void save()}>
            {existing ? 'Сохранить' : 'Установить'}
          </button>
        </div>
      </div>
    </div></Portal>
  )
}
