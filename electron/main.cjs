const { app, BrowserWindow, shell, session, desktopCapturer, ipcMain, Tray, Menu, nativeImage, clipboard } = require('electron')
const path = require('path')

const isDev = !app.isPackaged

// ---- v1.55.0: приложение живёт в фоне (трей + автозапуск с Windows) ----
// Закрытие окна сворачивает в трей: активность, звонки и уведомления работают,
// даже когда окно «выключено». Полный выход — через меню трея.
let tray = null
let quitting = false
const startHidden = process.argv.includes('--hidden')   // автозапуск стартует скрыто, сразу в трей
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')
function readPrefs() { try { return JSON.parse(require('fs').readFileSync(prefsFile(), 'utf8')) } catch { return {} } }
function writePrefs(p) { try { require('fs').writeFileSync(prefsFile(), JSON.stringify(p)) } catch {} }

// Вторая копия приложения не запускается — просто показывает уже работающую.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
}

function showMainWindow() {
  const w = BrowserWindow.getAllWindows().find(x => x !== splash)
  if (w) { try { if (w.isMinimized()) w.restore(); w.show(); w.focus() } catch {}; return }
  const nw = createWindow()
  nw.once('ready-to-show', () => { try { nw.show(); nw.focus() } catch {} })
}

// ---- Авто-детект игр (как в Discord) ----
// Раз в 4 секунды (как в Discord) смотрим ОКНА Windows (PowerShell Get-Process). Рендереру шлём событие ТОЛЬКО
// при старте/выходе из игры ({ name, since } | null) — таймер тикает у зрителей сам.
const GAMES = {
  'cs2.exe': 'Counter-Strike 2',
  'csgo.exe': 'CS:GO',
  'dota2.exe': 'Dota 2',
  'valorant.exe': 'VALORANT',
  'valorant-win64-shipping.exe': 'VALORANT',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends',
  'league of legends.exe': 'League of Legends',
  'rocketleague.exe': 'Rocket League',
  'gta5.exe': 'GTA V',
  'rustclient.exe': 'Rust',
  'tslgame.exe': 'PUBG',
  'overwatch.exe': 'Overwatch 2',
  'minecraft.windows.exe': 'Minecraft',
  'javaw.exe': 'Minecraft (Java)',
  'robloxplayerbeta.exe': 'Roblox',
  'eldenring.exe': 'Elden Ring',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'witcher3.exe': 'The Witcher 3',
  'genshinimpact.exe': 'Genshin Impact',
  'aces.exe': 'War Thunder',
  'worldoftanks.exe': 'World of Tanks',
  'osu!.exe': 'osu!',
  'terraria.exe': 'Terraria',
  'stardewvalley.exe': 'Stardew Valley',
  'factorio.exe': 'Factorio',
  'hollowknight.exe': 'Hollow Knight',
  'deltaforce.exe': 'Delta Force',
  'deltaforceclient-win64-shipping.exe': 'Delta Force',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'discovery.exe': 'THE FINALS',
  'helldivers2.exe': 'HELLDIVERS 2',
  'bg3.exe': "Baldur's Gate 3",
  'bg3_dx11.exe': "Baldur's Gate 3",
  'starfield.exe': 'Starfield',
  'hogwartslegacy.exe': 'Hogwarts Legacy',
  'warframe.x64.exe': 'Warframe',
  'destiny2.exe': 'Destiny 2',
  'wow.exe': 'World of Warcraft',
  'diablo iv.exe': 'Diablo IV',
  'palworld-win64-shipping.exe': 'Palworld',
  'readyornot-win64-shipping.exe': 'Ready or Not',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'ts4_x64.exe': 'The Sims 4',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_dx11.exe': 'Rainbow Six Siege',
}
let curGame = null   // { name, since } | null

function broadcastGame() {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('ponoi-game', curGame) } catch {}
  }
}

// ---- Поиск обложки игры (магазин Steam, без ключей) ----
// Вызывается рендерером через IPC; ищем в main-процессе (Node, нет CORS).
const coverCache = new Map()   // name -> url | null (кэш на время работы приложения)
function httpJson(u) {
  return new Promise((resolve) => {
    const https = require('https')
    const req = https.get(u, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(8000, () => { try { req.destroy() } catch {} resolve(null) })
  })
}
// Как httpJson, но без проверки сертификата — для локальных API игр
// (Live Client Data API у League of Legends на 127.0.0.1:2999 отдаёт самоподписанный сертификат Riot).
function httpJsonInsecure(u) {
  return new Promise((resolve) => {
    const https = require('https')
    const req = https.get(u, { rejectUnauthorized: false }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(3000, () => { try { req.destroy() } catch {} resolve(null) })
  })
}
// v1.28.0: два источника обложек. Steam покрывает ПК-игры, iTunes Search — не-стимовские
// (Roblox, Fortnite, VALORANT и т.п. — у них есть iOS-версии с квадратными иконками).
// v1.84.0: обложка не «первая попавшаяся», а реально совпадающая по названию —
// раньше Steam мог подсунуть чужую игру (фейк-обложку). Не нашли похожую в
// Steam — iTunes; не нашли и там — честный null (заглушка), а не чужая картинка.
function normName(s) {
  return String(s || '').toLowerCase().replace(/[\u2122\u00ae\u00a9]/g, '').replace(/[^a-z\u0430-\u044f\u04510-9]+/gi, ' ').trim()
}
async function findCover(name) {
  if (!name) return null
  if (coverCache.has(name)) return coverCache.get(name)
  const term = name.replace(/\(.*?\)/g, '').trim()   // «Minecraft (Java)» -> «Minecraft»
  const nt = normName(term)
  let url = null
  const st = await httpJson('https://store.steampowered.com/api/storesearch/?l=en&cc=US&term=' + encodeURIComponent(term))
  const items = (st && st.items) || []
  let item = items.find((i) => normName(i.name) === nt)
  if (!item) item = items.find((i) => { const n = normName(i.name); return n.startsWith(nt) || nt.startsWith(n) })
  if (!item) item = items.find((i) => normName(i.name).includes(nt))
  if (item) url = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + item.id + '/header.jpg'
  if (!url) {
    const it = await httpJson('https://itunes.apple.com/search?media=software&limit=5&term=' + encodeURIComponent(term))
    const w = nt.split(' ')[0]
    const app = ((it && it.results) || []).find((a) => normName(a.trackName).includes(w))
    if (app) url = app.artworkUrl512 || app.artworkUrl100 || null
  }
  coverCache.set(name, url)
  return url
}
ipcMain.handle('ponoi-find-cover', (_e, name) => findCover(String(name || '')))

// ---- v1.91.0: надёжное копирование (текст/картинки) через системный буфер ----
// Браузерный Clipboard API в Electron может молча отказывать («document is not
// focused», file://-происхождение) — main-процесс кладёт в буфер напрямую.
ipcMain.handle('ponoi-clip-text', (_e, t) => { try { clipboard.writeText(String(t ?? '')); return true } catch { return false } })
ipcMain.handle('ponoi-clip-image', (_e, dataUrl) => {
  try {
    const img = nativeImage.createFromDataURL(String(dataUrl || ''))
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  } catch { return false }
})

// ---- v1.98.0: плашка-оверлей «друг начал играть в ту же игру» — как оверлей Discord ----
// Прозрачное click-through окно поверх всех окон, сверху по центру экрана: тёмная
// пилюля «Пользователь <ник> начал играть в <иконка> ИГРА». Показывается на 6 секунд.
// Работает поверх игр в оконном/безрамочном режиме; поверх эксклюзивного
// полноэкранного режима Windows не рисует чужие окна (это ограничение самой ОС).
let gameToastWin = null
let gameToastTimer = null
function showGameToast(p) {
  try {
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') return
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const rawName = (p && p.name) ? String(p.name) : '?'
    const name = esc(rawName)
    const game = esc(((p && p.game) ? String(p.game) : '').toUpperCase())
    const okUrl = (u) => typeof u === 'string' && /^https:\/\//.test(u)
    const avatar = okUrl(p && p.avatar) ? p.avatar : null
    const cover = okUrl(p && p.cover) ? p.cover : null
    const av = avatar ? '<img class="av" src="' + esc(avatar) + '">' : '<span class="av ph">' + esc(rawName[0].toUpperCase()) + '</span>'
    const ic = cover ? '<img class="gic" src="' + esc(cover) + '">' : '<span class="gic ph2">&#127918;</span>'
    const html = '<!doctype html><meta charset="utf-8"><style>' +
      'html,body{margin:0;background:transparent;overflow:hidden;-webkit-user-select:none}' +
      '.pill{display:flex;align-items:center;gap:10px;height:46px;padding:0 20px 0 7px;border-radius:23px;' +
      'background:rgba(10,10,10,.85);color:#e8e8e8;font:500 14px "Segoe UI",system-ui,sans-serif;' +
      'width:max-content;max-width:96vw;margin:8px auto 0;box-shadow:0 4px 18px rgba(0,0,0,.45);' +
      'animation:in .25s ease}' +
      '@keyframes in{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}' +
      '.av{width:32px;height:32px;border-radius:50%;object-fit:cover;flex:none}' +
      '.av.ph{display:flex;align-items:center;justify-content:center;background:#5865f2;color:#fff;font-weight:700;font-size:15px}' +
      '.tx{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:7px}' +
      'b{color:#fff;font-weight:700}' +
      '.gic{width:24px;height:24px;border-radius:6px;object-fit:cover;flex:none;background:#fff}' +
      '.ph2{display:flex;align-items:center;justify-content:center;background:transparent;font-size:18px}' +
      '.g{color:#fff;font-weight:800;letter-spacing:.5px}' +
      '</style><div class="pill">' + av + '<span class="tx"><span>Пользователь <b>' + name + '</b> начал играть в</span>' + ic + '<span class="g">' + game + '</span></span></div>'
    const { screen } = require('electron')
    const disp = screen.getPrimaryDisplay()
    const w = Math.min(760, disp.workArea.width - 40), h = 62
    if (!gameToastWin || gameToastWin.isDestroyed()) {
      gameToastWin = new BrowserWindow({
        width: w, height: h,
        x: Math.round(disp.workArea.x + (disp.workArea.width - w) / 2), y: disp.workArea.y + 6,
        frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
        alwaysOnTop: true, focusable: false, show: false, hasShadow: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      })
      gameToastWin.setIgnoreMouseEvents(true)
      gameToastWin.setAlwaysOnTop(true, 'screen-saver')
      gameToastWin.setMenuBarVisibility(false)
    }
    gameToastWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    gameToastWin.showInactive()
    clearTimeout(gameToastTimer)
    gameToastTimer = setTimeout(() => { try { if (gameToastWin && !gameToastWin.isDestroyed()) gameToastWin.hide() } catch {} }, 6000)
  } catch {}
}
ipcMain.on('ponoi-game-toast', (_e, p) => showGameToast(p))

// ---- v1.99.0: стартовый оверлей при входе в игру — как у Discord ----
// Как только пользователь сам зашёл в игру, поверх неё в левом верхнем углу всплывает
// панель: «Использование Ponoi из оверлея во время игры», кнопка «Открыть Ponoi» и список
// «Пригласите друзей поиграть» (аватар, ник, наигранное время в этой игре, кнопка-приглашение).
// Окно кликабельное (не click-through), но не забирает фокус у игры (focusable: false).
// v1.101.0: сама исчезает через 6 секунд (наведение мыши ставит таймер на паузу, чтобы
// успеть нажать), время играющих друзей тикает в реальном времени. Поверх эксклюзивного полноэкранного режима Windows
// сторонние окна не рисуются — это ограничение самой ОС.
let overlayWin = null
let overlayTimer = null
const SEND_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 11.5 20.5 3.6c.5-.2 1 .3.8.8L13.4 22c-.2.5-.9.5-1.1 0l-2.6-6.3c-.1-.2-.3-.4-.5-.5L3 12.6c-.5-.2-.5-.9 0-1.1Z" fill="currentColor"/></svg>'
function showGameOverlay(p) {
  try {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const gameRaw = (p && p.game) ? String(p.game) : ''
    const game = esc(gameRaw)
    const okUrl = (u) => typeof u === 'string' && /^https:\/\//.test(u)
    const cover = okUrl(p && p.cover) ? p.cover : null
    const friends = (Array.isArray(p && p.friends) ? p.friends : []).slice(0, 5)
    const fmt = (ms) => {
      const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
      const p2 = (n) => String(n).padStart(2, '0')
      return h > 0 ? h + ':' + p2(mm) + ':' + p2(ss) : mm + ':' + p2(ss)
    }
    const gic = cover ? '<img class="gic" src="' + esc(cover) + '">' : '<span class="gic ph2">&#127918;</span>'
    const rows = friends.map((f) => {
      const nm = String((f && f.name) || '?')
      const av = okUrl(f && f.avatar) ? '<img class="fav" src="' + esc(f.avatar) + '">' : '<span class="fav ph">' + esc(nm[0].toUpperCase()) + '</span>'
      const sub = (f && f.ms > 0) ? '<span class="ftime" data-ms="' + Math.floor(f.ms) + '"' + ((f && f.inGame) ? ' data-live="1"' : '') + '>&#127918; ' + fmt(f.ms) + '</span>'
        : ((f && f.online) ? '<span class="fon">В сети</span>' : '<span class="foff">Не в сети</span>')
      return '<div class="fr"><span class="favw">' + av + ((f && f.online) ? '<i class="dot"></i>' : '') + '</span>' +
        '<span class="ftx"><b>' + esc(nm) + '</b>' + sub + '</span>' +
        '<button class="inv" data-id="' + esc(String((f && f.id) || '')) + '" title="Пригласить">' + SEND_SVG + '</button></div>'
    }).join('')
    const html = '<!doctype html><meta charset="utf-8"><style>' +
      'html,body{margin:0;background:transparent;overflow:hidden;-webkit-user-select:none;font:500 14px "Segoe UI",system-ui,sans-serif}' +
      '.panel{background:rgba(17,18,20,.92);border-radius:8px;margin:6px;box-shadow:0 6px 22px rgba(0,0,0,.5);overflow:hidden;animation:in .22s ease}' +
      '@keyframes in{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}' +
      '.head{display:flex;gap:12px;padding:14px 14px 10px;align-items:flex-start}' +
      '.gic{width:40px;height:40px;border-radius:8px;object-fit:cover;flex:none;background:#fff}' +
      '.ph2{display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);font-size:22px}' +
      '.ht{flex:1;min-width:0}' +
      '.h1{color:#f2f3f5;font-weight:700;font-size:15px;line-height:1.25}' +
      '.h2{color:#949ba4;font-size:12px;margin-top:4px}' +
      '.golive{display:inline-block;margin:2px 14px 12px;background:#248046;color:#fff;font-weight:600;font-size:14px;border:none;border-radius:4px;padding:8px 18px;cursor:pointer}' +
      '.golive:hover{background:#1a6334}' +
      '.sect{border-top:1px solid rgba(255,255,255,.07);padding:10px 14px 6px;color:#b5bac1;font-size:13px;font-weight:600}' +
      '.fr{display:flex;align-items:center;gap:10px;padding:7px 14px}' +
      '.favw{position:relative;flex:none;width:36px;height:36px}' +
      '.fav{width:36px;height:36px;border-radius:50%;object-fit:cover;display:block}' +
      '.fav.ph{display:flex;align-items:center;justify-content:center;background:#5865f2;color:#fff;font-weight:700;font-size:16px}' +
      '.dot{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:50%;background:#23a55a;border:3px solid #111214}' +
      '.ftx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}' +
      '.ftx b{color:#f2f3f5;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ftime{color:#23a55a;font-size:12px;font-weight:600}' +
      '.fon{color:#23a55a;font-size:12px}.foff{color:#80848e;font-size:12px}' +
      '.inv{flex:none;width:38px;height:34px;border-radius:6px;border:none;background:#2b2d31;color:#dbdee1;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '.inv:hover{background:#35373c;color:#fff}' +
      '.fr:hover{background:rgba(255,255,255,.045)}' +
      '.ov-x{flex:none;width:22px;height:22px;margin-left:4px;border:none;border-radius:4px;background:transparent;color:#80848e;cursor:pointer;font-size:12px;line-height:1;padding:0}' +
      '.ov-x:hover{color:#fff;background:rgba(255,255,255,.08)}' +
      '.sent{flex:none;width:38px;height:34px;display:flex;align-items:center;justify-content:center;color:#23a55a;font-weight:800;font-size:17px}' +
      '</style><div class="panel">' +
      '<div class="head">' + gic + '<div class="ht"><div class="h1">Использование Ponoi из оверлея во время игры</div>' +
      '<div class="h2">Ponoi показывает уведомления поверх игры</div></div><button class="ov-x" id="ovclose" title="Закрыть">&#10005;</button></div>' +
      '<button class="golive" id="openapp">Открыть Ponoi</button>' +
      (friends.length ? '<div class="sect">Пригласите друзей поиграть</div>' + rows : '') +
      '<div style="height:8px"></div></div>' +
      '<scr' + 'ipt>var GAME=' + JSON.stringify(gameRaw) + ';' +
      'document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;' +
      'if(b.classList.contains("inv")){window.ponoiOverlay.invite(b.dataset.id,GAME);var s=document.createElement("span");s.className="sent";s.innerHTML="&#10003;";b.replaceWith(s);}' +
      'if(b.id==="openapp"){window.ponoiOverlay.openApp();}' +
      'if(b.id==="ovclose"){window.ponoiOverlay.close();}});' +
      'function FMT(ms){var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60,p=function(n){return String(n).padStart(2,"0")};return h>0?h+":"+p(m)+":"+p(x):m+":"+p(x)}' +
      'setInterval(function(){var els=document.querySelectorAll(".ftime[data-live]");for(var i=0;i<els.length;i++){var el=els[i],ms=(Number(el.dataset.ms)||0)+1000;el.dataset.ms=String(ms);el.innerHTML="&#127918; "+FMT(ms)}},1000);' +
      'var over=false,left=6000;' +
      'document.documentElement.addEventListener("mouseenter",function(){over=true});' +
      'document.documentElement.addEventListener("mouseleave",function(){over=false});' +
      'var tick=setInterval(function(){if(over)return;left-=200;if(left<=0){clearInterval(tick);window.ponoiOverlay.close();}},200);' +
      '</scr' + 'ipt>'
    const { screen } = require('electron')
    const wa = screen.getPrimaryDisplay().workArea
    const h = Math.min(wa.height - 40, 152 + (friends.length ? 40 + 50 * friends.length : 0))
    if (overlayWin && !overlayWin.isDestroyed()) { try { overlayWin.destroy() } catch {} }
    overlayWin = new BrowserWindow({
      width: 372, height: h, x: wa.x + 10, y: wa.y + 10,
      frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, show: false, hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'overlay-preload.cjs') },
    })
    overlayWin.setAlwaysOnTop(true, 'screen-saver')
    overlayWin.setMenuBarVisibility(false)
    overlayWin.webContents.once('did-finish-load', () => { try { overlayWin.showInactive() } catch {} })
    overlayWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    clearTimeout(overlayTimer)
    overlayTimer = setTimeout(() => { try { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy() } catch {} }, 60_000)   // страховка; обычно панель закрывает себя сама через 6 сек
  } catch {}
}
ipcMain.on('ponoi-game-overlay', (_e, p) => showGameOverlay(p))
ipcMain.on('ponoi-overlay-invite', (_e, p) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === overlayWin || w === gameToastWin) continue
    try { w.webContents.send('ponoi-overlay-invite', p) } catch {}
  }
})
ipcMain.on('ponoi-overlay-open', () => {
  try { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy() } catch {}
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === overlayWin || w === gameToastWin) continue
    try { w.show(); w.focus() } catch {}
    break
  }
})
ipcMain.on('ponoi-overlay-close', () => { try { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy() } catch {} })

// ---- v1.100.0: красный кружок с числом непрочитанного на иконке в панели задач ----
// Рендерер рисует кружок на canvas и присылает PNG + число; main вешает его
// overlay-иконкой на окно (Windows). Ноль — снимаем. Если окно не в фокусе,
// иконка в панели задач ещё и мигает (как у Discord).
ipcMain.on('ponoi-badge', (_e, p) => {
  try {
    const n = Math.max(0, Number(p && p.count) || 0)
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === overlayWin || w === gameToastWin || w === splash) continue
      if (n > 0 && p && typeof p.dataUrl === 'string') {
        const img = nativeImage.createFromDataURL(p.dataUrl)
        if (!img.isEmpty()) {
          w.setOverlayIcon(img, 'Непрочитанных: ' + n)
          if (!w.isFocused()) w.flashFrame(true)
        }
      } else {
        w.setOverlayIcon(null, '')
      }
    }
  } catch {}
})

// ---- v1.89.0: режим (плейс) Roblox — как в Discord ----
// Roblox пишет подробный лог в %LOCALAPPDATA%\Roblox\logs. При входе в плейс там
// появляется строка «Joining game '<guid>' place <id> …» — из неё берём placeId,
// а имя плейса узнаём у публичного API Roblox (place -> universe -> название).
const placeNameCache = new Map()   // placeId -> name (кэшируем только удачные ответы)
async function robloxPlaceName(placeId) {
  if (placeNameCache.has(placeId)) return placeNameCache.get(placeId)
  let name = null
  const u = await httpJson('https://apis.roblox.com/universes/v1/places/' + placeId + '/universe')
  if (u && u.universeId) {
    const g = await httpJson('https://games.roblox.com/v1/games?universeIds=' + u.universeId)
    name = (g && g.data && g.data[0] && g.data[0].name) || null
  }
  if (name) placeNameCache.set(placeId, name)
  return name
}
// Свежайший лог-файл Roblox и последнее событие в нём: если после последнего
// входа в плейс не было выхода — игрок сейчас в этом плейсе.
function robloxCurrentPlaceId() {
  try {
    const fsr = require('fs')
    const dir = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'logs')
    let newest = null, newestAt = 0
    for (const f of fsr.readdirSync(dir)) {
      if (!f.endsWith('.log')) continue
      const at = fsr.statSync(path.join(dir, f)).mtimeMs
      if (at > newestAt) { newestAt = at; newest = f }
    }
    if (!newest) return null
    const full = path.join(dir, newest)
    const size = fsr.statSync(full).size
    const len = Math.min(size, 512 * 1024)   // хвоста в полмегабайта хватает с запасом
    const buf = Buffer.alloc(len)
    const fd = fsr.openSync(full, 'r')
    fsr.readSync(fd, buf, 0, len, size - len)
    fsr.closeSync(fd)
    const txt = buf.toString('utf8')
    let joinAt = -1, placeId = null
    const re = /[Jj]oining game '[^']*' place (\d+)/g
    let m
    while ((m = re.exec(txt))) { joinAt = m.index; placeId = m[1] }
    const leaveAt = Math.max(txt.lastIndexOf('leaveUGCGameInternal'), txt.lastIndexOf('Client:Disconnect'))
    if (placeId == null || leaveAt > joinAt) return null
    return placeId
  } catch { return null }
}
// ---- v1.90.0: режимы/детали игр — расширяемая система ----
// Discord получает «в лобби / в катке» от самих игр. У нас так же, где возможно:
// CS2 и Dota 2 — через официальный Game State Integration (Valve): кладём конфиг
// в папку игры, и игра сама шлёт состояние на локальный порт. Roblox — лог.
// Dead by Daylight — best-effort по логу игры (официального API нет).
let lastGsi = null   // { appid, data, at } — последний пакет от игры по GSI
try {
  const httpSrv = require('http')
  httpSrv.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy() })
    req.on('end', () => {
      try {
        const j = JSON.parse(body)
        lastGsi = { appid: String((j.provider && j.provider.appid) || ''), data: j, at: Date.now() }
      } catch {}
      res.end('ok')
    })
  }).listen(3947, '127.0.0.1')
} catch {}
const GSI_CFG = ['"Ponoi GSI"', '{', ' "uri" "http://127.0.0.1:3947"', ' "timeout" "1.0"', ' "buffer" "0.5"',
  ' "throttle" "1.0"', ' "heartbeat" "10.0"', ' "data"', ' {', '  "provider" "1"', '  "map" "1"',
  '  "player_id" "1"', '  "player_state" "1"', '  "hero" "1"', ' }', '}', ''].join('\n')
// Конфиг GSI подкладывается, когда игра запущена (путь берём из её exe).
// Игра прочтёт его при СЛЕДУЮЩЕМ запуске — это ограничение самой Valve.
function ensureGsiCfg(game, exe) {
  try {
    if (!exe) return
    const fsr = require('fs')
    const root = exe.replace(/[\\/]game[\\/].*$/i, '')
    if (game === 'Counter-Strike 2') {
      const dir = path.join(root, 'game', 'csgo', 'cfg')
      if (fsr.existsSync(dir)) { const f = path.join(dir, 'gamestate_integration_ponoi.cfg'); if (!fsr.existsSync(f)) fsr.writeFileSync(f, GSI_CFG) }
    } else if (game === 'Dota 2') {
      if (!fsr.existsSync(path.join(root, 'game', 'dota'))) return
      const dir = path.join(root, 'game', 'dota', 'cfg', 'gamestate_integration')
      try { fsr.mkdirSync(dir, { recursive: true }) } catch {}
      const f = path.join(dir, 'gamestate_integration_ponoi.cfg')
      if (!fsr.existsSync(f)) fsr.writeFileSync(f, GSI_CFG)
    }
  } catch {}
}
const CS_MODES = { competitive: 'Соревновательный', premier: 'Premier', scrimcomp2v2: 'Напарники',
  casual: 'Обычный', deathmatch: 'Бой насмерть', gungameprogressive: 'Гонка вооружений',
  gungametrbomb: 'Подрыв', survival: 'Запретная зона', coop: 'Кооператив' }
// Человеческие имена карт CS2 — как показывает Discord (de_mirage -> Mirage).
const CS_MAPS = { de_mirage: 'Mirage', de_dust2: 'Dust II', de_inferno: 'Inferno', de_nuke: 'Nuke',
  de_ancient: 'Ancient', de_anubis: 'Anubis', de_vertigo: 'Vertigo', de_overpass: 'Overpass',
  de_train: 'Train', de_cache: 'Cache', cs_office: 'Office', cs_italy: 'Italy' }
function cs2Mode() {
  if (!lastGsi || lastGsi.appid !== '730' || Date.now() - lastGsi.at > 60_000) return null
  const d = lastGsi.data
  const map = d.map
  if (map && map.name) {
    const m = CS_MODES[String(map.mode || '').toLowerCase()] || null
    const nice = CS_MAPS[String(map.name || '').toLowerCase()] || map.name
    const score = (map.team_ct && map.team_t && map.team_ct.score != null && map.team_t.score != null)
      ? ' · ' + map.team_ct.score + ':' + map.team_t.score : ''
    return (m ? m + ' — ' : 'В матче — ') + nice + score
  }
  if (d.player && d.player.activity === 'menu') return 'В лобби'
  return null
}
const DOTA_STATES = { DOTA_GAMERULES_STATE_HERO_SELECTION: 'Выбор героев', DOTA_GAMERULES_STATE_STRATEGY_TIME: 'Стадия стратегии',
  DOTA_GAMERULES_STATE_TEAM_SHOWCASE: 'Показ команд', DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: 'Загрузка',
  DOTA_GAMERULES_STATE_PRE_GAME: 'Подготовка', DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: 'В матче', DOTA_GAMERULES_STATE_POST_GAME: 'Конец матча' }
function dotaMode() {
  if (!lastGsi || lastGsi.appid !== '570' || Date.now() - lastGsi.at > 60_000) return null
  const d = lastGsi.data
  const st = d.map ? (DOTA_STATES[d.map.game_state] || null) : null
  const hero = (d.hero && d.hero.name)
    ? d.hero.name.replace(/^npc_dota_hero_/, '').replace(/_/g, ' ').replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()) : null
  if (st && hero) return st + ' — ' + hero
  if (st) return st
  return null
}
// Dead by Daylight: официального API нет — читаем хвост лога игры.
// Роль: внутренние имена DBD — Slasher (убийца) и Camper (выживший). Карта — последний
// загруженный уровень. Если игра перестанет писать это в лог — просто не покажем ничего.
function dbdMode() {
  try {
    const fsr = require('fs')
    const f = path.join(process.env.LOCALAPPDATA || '', 'DeadByDaylight', 'Saved', 'Logs', 'DeadByDaylight.log')
    if (!fsr.existsSync(f)) return null
    const size = fsr.statSync(f).size
    const len = Math.min(size, 256 * 1024)
    const buf = Buffer.alloc(len)
    const fd = fsr.openSync(f, 'r')
    fsr.readSync(fd, buf, 0, len, size - len)
    fsr.closeSync(fd)
    const txt = buf.toString('utf8')
    let role = null
    const rm = [...txt.matchAll(/(?:VE_|EPlayerRole::)(Slasher|Camper)/g)]
    if (rm.length) role = rm[rm.length - 1][1] === 'Slasher' ? 'За убийцу' : 'За выжившего'
    let map = null
    const mm = [...txt.matchAll(/[\\/]Game[\\/]Maps[\\/](?:[\w]+[\\/])*(?:Lvl_)?(\w{3,40}?)(?:_Procedural)?\.\w/g)]
    if (mm.length) {
      const raw = mm[mm.length - 1][1].replace(/^(Lvl|Map|Level)_?/i, '').replace(/_/g, ' ').trim()
      if (raw && !/^(menu|lobby|offline|frontend)$/i.test(raw)) map = raw
    }
    if (role && map) return role + ' · ' + map
    return role || (map ? 'Карта: ' + map : null)
  } catch { return null }
}
// League of Legends: официальный Live Client Data API (порт 2999) — доступен только
// во время матча. Берём своего чемпиона и режим; в лобби/клиенте порт закрыт.
const LOL_MODES = { CLASSIC: 'Ущелье призывателей', ARAM: 'ARAM', CHERRY: 'Арена', URF: 'URF',
  NEXUSBLITZ: 'Nexus Blitz', ULTBOOK: 'Книга заклинаний' }
async function lolMode() {
  const j = await httpJsonInsecure('https://127.0.0.1:2999/liveclientdata/allgamedata')
  if (!j || !j.gameData) return null   // матч ещё грузится — покажем просто название игры
  const mode = LOL_MODES[String(j.gameData.gameMode || '').toUpperCase()] || null
  const meName = (j.activePlayer && j.activePlayer.summonerName) || ''
  let champ = null
  if (Array.isArray(j.allPlayers)) {
    const p = j.allPlayers.find((x) => x.summonerName === meName || (x.riotIdGameName && meName.indexOf(x.riotIdGameName) === 0))
    champ = (p && p.championName) || null
  }
  const head = champ ? 'В матче — ' + champ : 'В матче'
  return head + (mode ? ' · ' + mode : '')
}
// Minecraft: режим берём из заголовка окна («… - Singleplayer» / «… - Multiplayer»).
function mcMode() {
  const t = String(curGameTitle || '')
  if (!/minecraft/i.test(t)) return null
  if (/single ?player|одиночн/i.test(t)) return 'Одиночная игра'
  if (/multi ?player|сетев|server/i.test(t)) return 'Сетевая игра'
  return null
}
let modeBusy = false
let lastPlaceId = null
let robloxModeName = null
async function scanGameMode() {
  if (process.platform !== 'win32' || modeBusy) return
  const g = curGame
  if (!g) { lastPlaceId = null; robloxModeName = null; return }
  modeBusy = true
  try {
    let mode = null
    if (g.name === 'Roblox') {
      const pid = robloxCurrentPlaceId()
      if (pid !== lastPlaceId) {
        lastPlaceId = pid
        robloxModeName = pid ? await robloxPlaceName(pid) : null
        if (pid && !robloxModeName) lastPlaceId = null   // имя не узнали (сеть/API) — попробуем ещё раз
      }
      mode = robloxModeName
    } else if (g.name === 'Counter-Strike 2') { ensureGsiCfg('Counter-Strike 2', curGameExe); mode = cs2Mode() }
    else if (g.name === 'Dota 2') { ensureGsiCfg('Dota 2', curGameExe); mode = dotaMode() }
    else if (g.name === 'Dead by Daylight') mode = dbdMode()
    else if (g.name === 'League of Legends') mode = await lolMode()
    else if (g.name === 'Minecraft' || g.name === 'Minecraft (Java)') mode = mcMode()
    if (curGame && curGame.name === g.name && (curGame.mode ?? null) !== (mode ?? null)) {
      curGame = { ...curGame, mode }
      broadcastGame()
    }
  } finally { modeBusy = false }
}


// v1.56.0: управление окном из нашего тайтлбара (нативные кнопки убраны).
ipcMain.on('win-minimize', (e) => { try { BrowserWindow.fromWebContents(e.sender)?.minimize() } catch {} })
ipcMain.on('win-toggle-max', (e) => { try { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.isMaximized() ? w.unmaximize() : w.maximize() } catch {} })
ipcMain.on('win-close', (e) => { try { BrowserWindow.fromWebContents(e.sender)?.close() } catch {} })

// Строгий детект (v1.49.1): спрашиваем у Windows ТОЛЬКО процессы с настоящим
// главным окном (MainWindowHandle ≠ 0 и непустой заголовок) через PowerShell —
// ровно так запущенную игру отличает от фоновой службы и Discord.
// tasklist для этого не годился: он пишет заголовок и у фоновых процессов
// (RobloxPlayerBeta, висящий в диспетчере после закрытия игры, детектился зря).
// javaw.exe — это любое Java-приложение: Minecraft'ом считаем только если
// заголовок окна содержит «minecraft». Старт игры публикуем после двух сканов
// подряд (~8 сек), чтобы не ловить мигающие процессы; закрытие гасим сразу.
const GAME_BY_PROC = {}
for (const [exe, nm] of Object.entries(GAMES)) GAME_BY_PROC[exe.replace(/\.exe$/, '')] = nm
// v1.55.0: универсальный детект ЛЮБЫХ игр (в т.ч. инди), как в Discord.
// PowerShell отдаёт процесс + путь exe + заголовок окна. Игра распознаётся:
// 1) по известному имени процесса (словарь GAMES выше), или
// 2) по расположению exe в папках игровых магазинов (Steam steamapps\common,
//    Epic Games, GOG, XboxGames, Riot Games, itch, Roblox) — имя игры берём
//    из папки игры. Лаунчеры и служебные процессы отсекает чёрный список.
const PS_SCAN = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + '|' + $_.Path + '|' + $_.MainWindowTitle }"
const NOT_GAMES = new Set([
  'steam', 'steamwebhelper', 'epicgameslauncher', 'epicwebhelper', 'galaxyclient', 'gog galaxy',
  'riot client', 'riotclientservices', 'riotclientux', 'leagueclientux', 'battle.net', 'agent',
  'launcher', 'robloxstudiobeta', 'itch', 'ubisoftconnect', 'upc', 'origin', 'eadesktop',
  'eabackgroundservice', 'crashhandler', 'unitycrashhandler32', 'unitycrashhandler64',
  'crashreportclient', 'easyanticheat', 'setup', 'unins000',
  // v1.65.0: браузеры/приложения — страховка для универсальных правил по папкам
  'chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'discord', 'spotify',
  'obs64', 'obs32', 'code', 'explorer', 'notepad', 'notepad++', 'wemod', 'medal',
  'overwolf', 'nvcontainer', 'telegram', 'whatsapp', 'epic games', 'riot games',
  'gog galaxy', 'wallpaper_engine', 'wallpaper32', 'wallpaper64',
  // v1.85.0: ещё не-игры, чтобы детект ничего не путал — лаунчеры/оверлеи/медиа/системное
  'playnite', 'playnite.desktopapp', 'playnite.fullscreenapp', 'geforce experience',
  'nvidia app', 'nvidia share', 'nvidia overlay', 'msiafterburner', 'rtss',
  'vlc', 'mpc-hc', 'mpc-hc64', 'potplayer', 'potplayermini64', 'obs',
  'applicationframehost', 'systemsettings', 'taskmgr', 'devenv', 'rider64',
  'idea64', 'pycharm64', 'webstorm64', 'photoshop', 'afterfx', 'gamebar',
  'gamingservices', 'xboxpcapp', 'vesktop', 'slack', 'skype', 'zoom', 'viber',
  'steamerrorreporter', 'gameoverlayui', 'ponoi',
])
const GAME_DIRS = [
  // Папки игровых магазинов — надёжный источник имени игры (приоритет 60)
  [/steamapps[\\/]common[\\/]([^\\/]+)/i, 1, 60],
  [/epic games[\\/]([^\\/]+)/i, 1, 60],
  [/gog galaxy[\\/]games[\\/]([^\\/]+)/i, 1, 60],
  [/gog games[\\/]([^\\/]+)/i, 1, 60],
  [/xboxgames[\\/]([^\\/]+)/i, 1, 60],
  [/riot games[\\/]([^\\/]+)/i, 1, 60],
  [/itch[\\/]apps[\\/]([^\\/]+)/i, 1, 60],
  [/roblox[\\/]versions[\\/]/i, 0, 60],
  // v1.65.0: больше источников — Wargaming, Garena, Battlestate
  [/wargaming(?:\.net)?[\\/]([^\\/]+)/i, 1, 60],
  [/garena[\\/]games?[\\/]([^\\/]+)/i, 1, 60],
  [/battlestate games[\\/]([^\\/]+)/i, 1, 60],
  // Универсальная папка Games/Игры на любом диске — самый слабый сигнал (приоритет 40):
  // сюда легко попадает и не-игра, поэтому такой кандидат легко перебивается
  [/[\\/](?:games|игры)[\\/]([^\\/]+)/i, 1, 40],
]
function prettyName(s) {
  return s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}
// Заголовки окон игр часто с хвостами («Игра  |  1.2.3», «Игра — сервер»,
// версии, ™/®) — берём первую осмысленную часть и чистим мусор.
function cleanTitle(t) {
  let s = (t || '').split(/\s+[|\u2013\u2014]\s+| {2,}/)[0].trim()
  s = s.replace(/[\u2122\u00ae\u00a9]/g, '').replace(/\s+v?\d+(\.\d+)+\s*$/i, '').trim()
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s
}
// Мусорные имена не публикуем: слишком короткие, голые цифры, служебные слова.
function isJunkName(s) {
  const n = (s || '').trim()
  if (n.length < 2) return true
  if (/^[\d.\s]+$/.test(n)) return true
  if (NOT_GAMES.has(n.toLowerCase())) return true
  return false
}
// v1.85.0: детект возвращает кандидата с приоритетом — чем надёжнее источник,
// тем выше. Раньше бралась первая попавшаяся строка скана, и случайный процесс
// (чужое окно, лаунчер из папки Games) мог перебить настоящую игру.
//   100 — известный процесс из словаря GAMES
//    80 — Unreal Engine-клиент (…-Win64-Shipping)
//    60 — exe в папке игрового магазина (Steam/Epic/GOG/Xbox/Riot/itch/…)
//    40 — универсальная папка Games/Игры
function detectGame(proc, exePath, title) {
  const nm = GAME_BY_PROC[proc]
  if (nm) {
    if (proc === 'javaw' && !title.toLowerCase().includes('minecraft')) return null
    return { name: nm, prio: 100 }
  }
  if (NOT_GAMES.has(proc)) return null
  // Сначала папка магазина: имя из неё надёжнее заголовка окна.
  let dirHit = null
  if (exePath) {
    for (const [re, grp, prio] of GAME_DIRS) {
      const m = exePath.match(re)
      if (!m) continue
      if (grp === 0) { dirHit = { name: 'Roblox', prio }; break }
      let name = m[grp]
      if (!name || NOT_GAMES.has(name.toLowerCase())) break
      // exe бывает зарыт в служебную папку — тогда лучше заголовок окна
      if (/^(binaries|bin|win64|win32|x64|x86|client|shipping|game|live|retail|content)$/i.test(name)) name = cleanTitle(title) || name
      name = prettyName(name)
      if (!isJunkName(name)) dirHit = { name, prio }
      break
    }
  }
  // v1.65.0: любой Unreal Engine-клиент (…-Win64-Shipping) — это игра. Работает
  // даже когда путь к exe недоступен: анти-чит часто запускает игру с правами
  // выше наших, и Windows прячет Path (так было с Delta Force).
  // Имя берём по надёжности: папка магазина > заголовок окна > имя процесса.
  const ue = proc.match(/^(.+?)(?:client|game)?-win(?:64|32)-shipping$/)
  if (ue) {
    const name = (dirHit && dirHit.name) || cleanTitle(title) || prettyName(ue[1])
    return isJunkName(name) ? null : { name, prio: 80 }
  }
  return dirHit
}
let pendingGame = null   // кандидат на старт: { name, at, exe }
let curGameExe = null    // путь exe текущей игры — чтобы подложить GSI-конфиг (v1.90.0)
let curGameTitle = null  // заголовок окна текущей игры — детали для Minecraft (v1.97.0)
let scanBusy = false     // не пускаем сканы внахлёст
function scanGames() {
  if (process.platform !== 'win32' || scanBusy) return
  scanBusy = true
  const { execFile } = require('child_process')
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCAN], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    scanBusy = false
    if (err || !out) return
    // v1.85.0: собираем ВСЕХ кандидатов и берём самого надёжного (по приоритету),
    // а не первую попавшуюся строку — так случайные окна не путают игры.
    let best = null
    for (const line of String(out).split('\n')) {
      const parts = line.split('|')
      if (parts.length < 3) continue
      const proc = parts[0].trim().toLowerCase()
      const exePath = parts[1].trim()
      const title = parts.slice(2).join('|').trim()
      if (!title) continue
      const cand = detectGame(proc, exePath, title)
      if (!cand) continue
      if (!best || cand.prio > best.prio) best = { ...cand, exe: exePath, title }
      if (best.prio >= 100) break
    }
    const found = best ? best.name : null
    if (found) {
      if (curGame && curGame.name === found) { pendingGame = null; curGameTitle = best.title || curGameTitle; return }   // уже играет — обновляем заголовок окна
      if (pendingGame && pendingGame.name === found) {                        // подтверждено вторым сканом
        curGame = { name: found, since: pendingGame.at }
        curGameExe = pendingGame.exe || null
        curGameTitle = pendingGame.title || null
        pendingGame = null
        broadcastGame()
      } else {
        pendingGame = { name: found, at: Date.now(), exe: best.exe, title: best.title }   // ждём подтверждения вторым сканом
      }
      return
    }
    pendingGame = null
    curGameExe = null
    curGameTitle = null
    if (curGame) { curGame = null; broadcastGame() }   // игра закрылась — гасим сразу
  })
}

// ---- Неоновый splash при запуске (компактный, как у Discord) ----
// Frameless-окно 340x320: логотип и статус запуска. Пока оно крутится,
// приложение готовится и проверяет обновления; затем схлопывается.
let splash = null
const SPLASH_MIN_MS = 1100   // v1.31.0: короче — приложение стартует заметно быстрее
let splashShownAt = 0

function createSplash() {
  splash = new BrowserWindow({
    width: 340,
    height: 320,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'ponoi',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  splashShownAt = Date.now()
  splash.on('closed', () => { splash = null })
}

let appShown = false   // v1.31.2: страховки могут дёрнуть повторно — показываем окно один раз
function closeSplashAndShow(win) {
  if (appShown) return
  appShown = true
  if (startHidden) { try { splash?.close() } catch {}; return }   // v1.55.0: автозапуск — сидим в трее, окно не показываем
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt))
  setTimeout(() => {
    try { splash?.webContents.send('splash-done') } catch {}
    // Даём splash-у доиграть «схлопывание» (fade из splash.html), затем показываем приложение.
    // v1.31.0: открываемся развёрнутыми на весь экран (как Discord), а не маленьким окном.
    setTimeout(() => { try { splash?.close() } catch {}; try { win.maximize(); win.show(); win.focus() } catch {} }, 300)
  }, wait)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#313338',
    autoHideMenuBar: true,
    title: 'Ponoi',
    // v1.56.0: без системной рамки и БЕЗ нативного Windows-overlay — тайтлбар и
    // кнопки окна рисует рендерер (как в Discord). Overlay убрали: он рисовался
    // поверх приложения и ломался, когда его что-то перекрывало.
    titleBarStyle: 'hidden',
    show: false,   // показываем только после splash
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // v1.55.0: в трее/фоне активность, звонки и уведомления работают без замедления
    },
  })

  // v1.55.0: закрытие окна = свернуть в трей (как в Discord). Полный выход — из меню трея.
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide() }
  })

  win.once('ready-to-show', () => closeSplashAndShow(win))

  // v1.56.0: транслируем рендереру состояние окна (развёрнуто/восстановлено),
  // чтобы кнопка разворачивания в нашем тайтлбаре меняла иконку.
  const sendMax = () => { try { win.webContents.send('win-maximized', win.isMaximized()) } catch {} }
  win.on('maximize', sendMax)
  win.on('unmaximize', sendMax)
  win.webContents.on('did-finish-load', sendMax)

  // v1.31.2: страховка от «вечного» сплэша. Если ready-to-show по какой-то причине
  // не пришёл (тяжёлый первый запуск после установки, сбой отрисовки) — всё равно
  // показываем окно: после полной загрузки страницы или максимум через 10 секунд.
  win.webContents.once('did-finish-load', () => setTimeout(() => closeSplashAndShow(win), 400))
  win.webContents.once('did-fail-load', () => closeSplashAndShow(win))
  setTimeout(() => closeSplashAndShow(win), 10_000)

  // Open external (http) links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Свежеоткрытому окну сразу сообщаем текущую игру (если она уже запущена).
  win.webContents.on('did-finish-load', () => { if (curGame) { try { win.webContents.send('ponoi-game', curGame) } catch {} } })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  return win
}

app.whenReady().then(() => {
  // Allow mic / camera / notifications (needed for LiveKit voice & video).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications'].includes(permission))
  })

  // Screen-share support: hand the first available screen to getDisplayMedia().
  session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      cb({ video: sources[0], audio: 'loopback' })
    }).catch(() => cb({}))
  }, { useSystemPicker: true })

  // Автообновления (как в Discord): проверяем GitHub Releases при запуске и
  // каждые 10 минут; обновление качается в фоне само — перезапускать приложение
  // для начала скачивания не нужно.
  if (!isDev) {
    try {
      const { autoUpdater } = require('electron-updater')
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      // v1.29.0: статус обновления транслируем в окно приложения — рендерер
      // показывает красивую карточку с прогрессом и кнопкой «Перезапустить».
      const bcastUpd = (data) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('ponoi-update', data) } catch {} } }
      // v1.47.1: «жёсткая» установка обновления. Обычный quitAndInstall закрывает окна
      // мягко, и beforeunload (например, предупреждение при активном голосе) не даёт
      // приложению выйти — установщик писал «Не удалось закрыть Ponoi. Закройте вручную».
      // destroy() обходит beforeunload, а снятие window-all-closed не даёт app.quit()
      // вклиниться раньше установки.
      const forceQuitAndInstall = () => {
        quitting = true
        try { tray?.destroy() } catch {}
        try { app.removeAllListeners('window-all-closed') } catch {}
        for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
        try { autoUpdater.quitAndInstall(true, true) } catch {}
      }
      autoUpdater.on('update-available', (info) => bcastUpd({ state: 'downloading', percent: 0, version: info && info.version }))
      autoUpdater.on('download-progress', (p) => {
        // Реальный прогресс скачивания обновления показываем в splash-окне и в карточке.
        try { splash?.webContents.send('splash-progress', { percent: p?.percent ?? 0 }) } catch {}
        bcastUpd({ state: 'downloading', percent: (p && p.percent) || 0 })
      })
      autoUpdater.on('update-downloaded', (info) => {
        // Обновление скачалось, пока мы на сплэше — сразу ставим его «жёстко».
        // v1.47.1: страховка от зависания на «100%»: если через 4 секунды мы почему-то
        // всё ещё живы — показываем приложение, обновление доставится при выходе.
        if (!appShown) {
          try { splash?.webContents.send('splash-progress', { percent: 100 }) } catch {}
          setTimeout(() => { try { const w = BrowserWindow.getAllWindows().find(x => x !== splash); if (w) closeSplashAndShow(w) } catch {} }, 4000)
          forceQuitAndInstall()
          return
        }
        bcastUpd({ state: 'ready', version: info && info.version })
      })
      // v1.47.1: ошибка обновления больше не подвешивает сплэш/карточку — прячем
      // прогресс и запускаемся как обычно; попробуем снова через 30 минут.
      autoUpdater.on('error', () => {
        try { splash?.webContents.send('splash-done') } catch {}
        bcastUpd({ state: 'error' })
      })
      ipcMain.on('ponoi-apply-update', () => forceQuitAndInstall())
      // v1.58.0: обновления прилетают ещё быстрее — проверяем GitHub при каждом
      // запуске и дальше каждые 10 минут (было 30), чтобы обнова начинала
      // скачиваться сама, без перезапуска приложения.
      const check = () => { try { autoUpdater.checkForUpdatesAndNotify().catch(() => {}) } catch {} }
      check()
      setInterval(check, 10 * 60 * 1000)
    } catch {}
  }

  // Игровая активность: первый скан сразу, дальше раз в 4 секунды (как в Discord).
  scanGames()
  setInterval(scanGames, 4_000)
  // v1.90.0: режимы игр (Roblox/CS2/Dota 2/DBD) — раз в 5 секунд.
  setInterval(scanGameMode, 5_000)

  // v1.37.1: после обновления версии один раз чистим HTTP- и код-кэш старой
  // версии, чтобы ничего не лагало. Логин и настройки (localStorage) не трогаем.
  try {
    const fsv = require('fs')
    const verFile = path.join(app.getPath('userData'), 'last-version.json')
    let prev = null
    try { prev = JSON.parse(fsv.readFileSync(verFile, 'utf8')).v } catch {}
    if (prev !== app.getVersion()) {
      try { fsv.writeFileSync(verFile, JSON.stringify({ v: app.getVersion() })) } catch {}
      const { session } = require('electron')
      try { session.defaultSession.clearCache().catch(() => {}) } catch {}
      try { session.defaultSession.clearCodeCaches({}).catch(() => {}) } catch {}
    }
  } catch {}

  // v1.55.0: иконка в трее — приложение живёт в фоне даже с закрытым окном.
  try {
    let icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'))
    if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, '..', 'dist', 'icon.png'))
    tray = new Tray(icon)
    tray.setToolTip('Ponoi')
    const auto = readPrefs().autostart !== false
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть Ponoi', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Автозапуск с Windows', type: 'checkbox', checked: auto,
        click: (mi) => {
          writePrefs({ ...readPrefs(), autostart: mi.checked })
          try { app.setLoginItemSettings({ openAtLogin: mi.checked, args: ['--hidden'] }) } catch {}
        },
      },
      { type: 'separator' },
      {
        label: 'Выйти из Ponoi',
        click: () => {
          quitting = true
          try { tray?.destroy() } catch {}
          for (const w of BrowserWindow.getAllWindows()) { try { w.destroy() } catch {} }
          app.quit()
        },
      },
    ]))
    tray.on('click', () => showMainWindow())
    tray.on('double-click', () => showMainWindow())
  } catch {}

  // v1.55.0: автозапуск с Windows (скрыто, в трей). Включён по умолчанию,
  // выключается галочкой в меню трея — выбор запоминается в prefs.json.
  if (!isDev && process.platform === 'win32' && readPrefs().autostart !== false) {
    try { app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }) } catch {}
  }

  if (!startHidden) createSplash()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { quitting = true })

app.on('window-all-closed', () => {
  // v1.55.0: окна закрыты, но приложение живёт в трее (активность, звонки,
  // уведомления). Полностью выходим только через «Выйти из Ponoi» в трее.
  if (process.platform !== 'darwin' && quitting) app.quit()
})
