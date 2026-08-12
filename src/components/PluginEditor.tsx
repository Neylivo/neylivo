import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { Portal } from './Portal'
import { toastOk, toastErr } from '../lib/toast'
import { confirmUi } from '../lib/confirm'
import { PicField } from './PicField'
import { useAuth } from '../auth/AuthProvider'
import { parsePlugin } from '../lib/plugins/manifest'
import { installPlugin } from '../lib/plugins/install'
import { getPlugin } from '../lib/plugins/store'
import { pluginError, isRunning } from '../lib/plugins/host'
import { ALL_PERMISSIONS, PERMISSION_LABEL, SENSITIVE_PERMISSIONS, type Permission } from '../lib/plugins/types'
import { publishPlugin, shorten, SUMMARY_MAX } from '../lib/catalog'
import {
  TEMPLATES, buildFile, draftFrom, draftFromTemplate, slugify, cleanPasted,
  missingPermissions, unusedPermissions, type Draft,
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
    if (!from) return draftFromTemplate(TEMPLATES[0])
    // Если шапка не прочиталась, имя и id берём из того, под чем плагин уже
    // установлен: иначе «Сохранить» завело бы второй плагин вместо правки.
    return {
      ...from,
      name: from.name || existing!.manifest.name,
      id: from.id || existing!.manifest.id,
      version: from.version || existing!.manifest.version,
      permissions: from.permissions.length ? from.permissions : existing!.manifest.permissions,
    }
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
  // Тело трогали руками, если оно не совпадает ни с заготовкой, ни с рецептом.
  // v1.346.0: чего коду не хватает. Раньше это выяснялось только на живом
  // человеке: плагин падал красной строкой «не выдано разрешение notify».
  const missing = useMemo(() => missingPermissions(d.body, d.permissions), [d.body, d.permissions])
  const unused = useMemo(() => unusedPermissions(d.body, d.permissions), [d.body, d.permissions])

  const dirtyBody = useMemo(() => {
    const base = mode === 'easy' ? recipe.build(rv) : (TEMPLATES.find(t => t.key === tpl)?.body ?? '')
    return d.body.trim() !== base.trim()
  }, [d.body, mode, recipe, rv, tpl])
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
      await installPlugin(m, file, null, true)
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
    if (missing.length > 0) {
      toastErr('Сначала добавь разрешения, которые просит код: '
        + missing.map(m => PERMISSION_LABEL[m.perm]).join(', '))
      return
    }
    setBusy(true)
    try {
      const m = parsePlugin(file)
      await installPlugin(m, file, null, true)
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
      await installPlugin(m, file, null, true)          // в каталог уходит ровно то, что работает
      setInstalled(true)
      await publishPlugin({
        id: m.id, name: m.name, version: m.version,
        summary: shorten(m.description || m.name, SUMMARY_MAX),
        description: m.description, icon_url: m.icon, banner_url: m.banner,
        code: file, permissions: m.permissions,
      }, user.id)
      toastOk('Плагин в каталоге — картинку и описание можно добавить там же')
      setPublishing(false)
      onSaved?.()
    } catch (e: any) { toastErr(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  /** Закрыть, не потеряв написанное молча. */
  async function tryClose() {
    const touched = !existing && (d.name.trim() || d.description.trim() || dirtyBody)
    if (touched && !await confirmUi('Закрыть конструктор? Плагин не установлен, написанное пропадёт.',
      { okText: 'Закрыть', danger: true })) return
    onClose()
  }

  function download() {
    const blob = new Blob([file], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (d.id || 'plugin') + '.neylivo'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  // v1.345.0: конструктор — отдельный экран, а не окошко.
  // Во-первых, места мало: код, поля и разрешения в модалку не помещались.
  // Во-вторых, промах мимо окна закрывал его вместе со всем написанным — здесь
  // клик по фону не делает НИЧЕГО, а закрытие с несохранённым спросит.
  return (
    <Portal><div className="ped-screen">
      <div className="ped-sheet">
        <div className="ped-top">
          <div className="ped-top-t">{existing ? 'Изменить плагин' : 'Новый плагин'}</div>
          <button className="ped-top-x" onClick={() => void tryClose()} title="Закрыть">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="ped-scroll">
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

        {/* v1.349.0: своё лицо у плагина — как у бота. Обе картинки необязательны:
            без них рисуется значок по умолчанию и мягкая заливка. */}
        <label className="modal-lbl">Как он будет выглядеть</label>
        <div className="botp-row">
          <div className="cat-tile as-preview" style={{ width: 200 }}>
            <div className={'cat-tile-bg' + (d.banner.trim() ? '' : ' plain')}
              style={d.banner.trim() ? { backgroundImage: `url(${d.banner.trim()})` } : undefined} />
            <div className="cat-tile-ic">
              {d.icon.trim() ? <img src={d.icon.trim()} alt="" /> : <span className="cat-emoji">🧩</span>}
            </div>
            <div className="cat-tile-body">
              <div className="cat-nm">{d.name || 'Мой плагин'}</div>
              <div className="cat-sum">{d.description || 'Короткое описание'}</div>
            </div>
          </div>
          <div className="botp-fields">
            <PicField label="Картинка" value={d.icon} onChange={v => set('icon', v)} />
            <PicField label="Шапка карточки" value={d.banner} onChange={v => set('banner', v)}
              hint="Так плагин будет выглядеть в каталоге и в списке установленных." />
          </div>
        </div>

        {mode === 'easy' && (
          <div className="ped-perm-note">
            Плагин попросит только то, без чего не заработает:{' '}
            {recipe.permissions.map(p => PERMISSION_LABEL[p]).join(', ').toLowerCase() || 'ничего'}.
          </div>
        )}

        {mode === 'code' && <>
        <label className="modal-lbl">Что плагину разрешено</label>
        {/* v1.485.0: разрешения больше не надо расставлять галочками вручную.
            Приложение и так ЗНАЕТ, что зовёт код (missingPermissions), — и
            раньше только показывало это красной строкой, оставляя человека
            щёлкать самому. Теперь оно может проставить их одним нажатием. */}
        <div className="ped-perm-acts">
          {missing.length > 0 && (
            <button type="button" className="pqs2-btn" onClick={() => {
              setD(prev => ({
                ...prev,
                permissions: [...prev.permissions, ...missing.map(m => m.perm).filter(x => !prev.permissions.includes(x))],
              }))
            }}>Добавить недостающие — {missing.length}</button>
          )}
          {unused.length > 0 && (
            <button type="button" className="pqs2-btn ghost" onClick={() => {
              setD(prev => ({ ...prev, permissions: prev.permissions.filter(x => !unused.includes(x)) }))
            }}>Убрать лишние — {unused.length}</button>
          )}
          <button type="button" className="pqs2-btn ghost" onClick={() => {
            setD(prev => ({ ...prev, permissions: [...ALL_PERMISSIONS] }))
          }} title="То же самое, что @permissions * в шапке">Разрешить всё</button>
        </div>
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
        {/* v1.426.0: вставку из чата с ИИ чистим сами. Ответ приходит названием,
            описанием и кодом внизу (так просил владелец), а человек копирует всё
            разом — и раньше получал «в файле нет шапки плагина», хотя приложение
            прекрасно видит, где начинается файл. */}
        <textarea className="ped-code" spellCheck={false} value={d.body}
          onPaste={e => {
            const raw = e.clipboardData?.getData('text') ?? ''
            if (!raw.includes('/**')) return
            const clean = cleanPasted(raw)
            if (clean.trim() === raw.trim()) return   // чистить нечего — обычная вставка
            e.preventDefault()
            set('body', clean)
            toastOk('Убрал лишнее вокруг кода — оставил сам файл')
          }}
          onChange={e => set('body', e.target.value)}
          placeholder="function onLoad(neylivo) { … }" />
        <div className="cset-hint" style={{ marginTop: 4 }}>
          Функция <code>onLoad</code> получает объект <code>neylivo</code> — через него плагин и работает.
          Полный список того, что он умеет, — в справке «?» рядом с заголовком раздела.
        </div>
        </>}

        {/* Разрешения — самая частая причина «плагин не работает». Говорим об
            этом ДО установки и чиним одной кнопкой, а не красной строкой потом. */}
        {missing.length > 0 && (
          <div className="ped-status warn">
            <Icon name="shield" size={14} />
            <span>
              Код зовёт {missing.map(m => m.what).join(', ')} — для этого нужно{' '}
              {missing.map(m => '«' + PERMISSION_LABEL[m.perm] + '»').join(', ')}.
              Без этого плагин не заработает.
            </span>
            <button className="ped-status-fix"
              onClick={() => setD(p => ({ ...p, permissions: [...p.permissions, ...missing.map(m => m.perm)] }))}>
              Добавить
            </button>
          </div>
        )}
        {missing.length === 0 && unused.length > 0 && mode === 'code' && (
          <div className="ped-status hint">
            <Icon name="check" size={14} />
            <span>
              Лишнее разрешение: {unused.map(p => '«' + PERMISSION_LABEL[p] + '»').join(', ')} — код им не
              пользуется. Человек увидит это при установке.
            </span>
            <button className="ped-status-fix"
              onClick={() => setD(p => ({ ...p, permissions: p.permissions.filter(x => !unused.includes(x)) }))}>
              Убрать
            </button>
          </div>
        )}

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
          <button className="modal-ghost" onClick={download} title="Сохранить как .neylivo-файл">
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
      </div>
    </div></Portal>
  )
}
