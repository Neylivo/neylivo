// v1.476.0: живая проверка возможностей плагинов, которых до сих пор ничем не
// проверяли. Запуск: npm run test:api
//
// ЧТО ЗДЕСЬ ГЛАВНОЕ — НАСТОЯЩИЙ СЕРВЕР.
//
// Сеть плагина (net.fetch, net.stream, net.ws) была написана в v1.445 и v1.465,
// покрыта проверками правил доступа — и ни разу не проверена на живом
// соединении. Мокнуть её нельзя: смысл именно в том, что запрос действительно
// уходит и ответ действительно приходит по кускам.
//
// Поэтому здесь поднимается настоящий сервер: https и wss на 127.0.0.1, со
// своим самоподписанным сертификатом. Electron такой сертификат обычно
// отвергает — мы его принимаем, но ТОЛЬКО для своего адреса и только в этой
// проверке (см. certificate-error ниже).
//
// WebSocket написан руками: в Node своего сервера нет, а тянуть зависимость
// ради проверки — плохой размен. Нужно немного: рукопожатие и разбор коротких
// текстовых кадров.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')
const crypto = require('crypto')

const OUT = path.join(__dirname, '..', 'dist-api-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:api')
  process.exit(1)
}
// Сертификат делаем на месте и НЕ храним в репозитории: закрытый ключ в
// исходниках — плохая привычка, даже если он от localhost и живёт год.
const CERTS = path.join(__dirname, 'api-test-certs')
if (!fs.existsSync(path.join(CERTS, 'cert.pem'))) {
  fs.mkdirSync(CERTS, { recursive: true })
  try {
    require('node:child_process').execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', path.join(CERTS, 'key.pem'), '-out', path.join(CERTS, 'cert.pem'),
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  } catch (e) {
    console.error('не удалось сделать сертификат (нужен openssl в PATH): ' + e.message)
    process.exit(1)
  }
}

const PORT = 8443
const HOST = '127.0.0.1'

// НАСТОЯЩИЕ стили приложения: без них «полный экран» это прямоугольник в 36
// пикселей высотой, и мерить его бессмысленно. Копируем файл рядом со сборкой.
fs.copyFileSync(path.join(__dirname, '..', 'src', 'styles.css'), path.join(OUT, 'styles.css'))
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><link rel=stylesheet href="styles.css">'
  + '<style>html,body{margin:0;height:100%;font:12px monospace;background:#111;color:#ddd}'
  // v1.487.0: pointer-events отключён у полотна вывода.
  //
  // Оно занимает всю страницу и лежит поверх всего, что рисуют плагины, — и
  // настоящая мышь попадала в НЕГО, а не в окно плагина. Выглядело это как
  // «перетаскивание не работает и наведение не работает»: обе проверки падали
  // на ровном месте, хотя ломался стенд, а не приложение. К самому приложению
  // это отношения не имеет: там поверх окон плагинов не лежит текстовое
  // полотно во весь экран.
  + '#out{white-space:pre;position:relative;z-index:1;pointer-events:none}</style>'
  + `<script>window.__порт = ${PORT}</script>`
  + '<div id=root></div><pre id=out>идёт…</pre><script src="t.js"></script>')

// ── сервер ──────────────────────────────────────────────────────────────────
const server = https.createServer({
  key: fs.readFileSync(path.join(CERTS, 'key.pem')),
  cert: fs.readFileSync(path.join(CERTS, 'cert.pem')),
}, (req, res) => {
  if (req.url === '/json') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify({ привет: 'мир', число: 42 }))
    return
  }
  if (req.url === '/stream') {
    // Отдаём кусками с задержкой — ровно так отвечают ИИ-модели, ради которых
    // поток и делался. Отдай мы всё разом, проверялось бы не то.
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
    const куски = ['раз ', 'два ', 'три ', 'конец']
    let i = 0
    const шаг = () => {
      if (i >= куски.length) { res.end(); return }
      res.write(куски[i++])
      setTimeout(шаг, 120)
    }
    шаг()
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE',
    })
    res.end()
    return
  }
  res.writeHead(404, { 'access-control-allow-origin': '*' })
  res.end('нет такого')
})

// ── WebSocket руками ────────────────────────────────────────────────────────
const МАГИЯ = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function кадр(текст) {
  const b = Buffer.from(текст, 'utf8')
  const голова = b.length < 126
    ? Buffer.from([0x81, b.length])
    : Buffer.concat([Buffer.from([0x81, 126]), (() => { const x = Buffer.alloc(2); x.writeUInt16BE(b.length); return x })()])
  return Buffer.concat([голова, b])
}

/** Разбор кадра от браузера. Он всегда с маской — это требование протокола. */
function разобрать(buf) {
  if (buf.length < 2) return null
  const код = buf[0] & 0x0f
  const маска = (buf[1] & 0x80) !== 0
  let длина = buf[1] & 0x7f
  let p = 2
  if (длина === 126) { длина = buf.readUInt16BE(2); p = 4 }
  else if (длина === 127) { длина = Number(buf.readBigUInt64BE(2)); p = 10 }
  const ключ = маска ? buf.slice(p, p + 4) : null
  p += маска ? 4 : 0
  const тело = buf.slice(p, p + длина)
  if (ключ) for (let i = 0; i < тело.length; i++) тело[i] ^= ключ[i % 4]
  return { код, текст: тело.toString('utf8') }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  const accept = crypto.createHash('sha1').update(key + МАГИЯ).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
    + 'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n',
  )
  socket.write(кадр('привет от сервера'))
  socket.on('data', buf => {
    const f = разобрать(buf)
    if (!f) return
    if (f.код === 8) { socket.end(); return }          // закрытие
    if (f.код === 1) socket.write(кадр('эхо:' + f.текст))
  })
  socket.on('error', () => {})
})

// v1.490.0: аппаратное ускорение НЕ выключаем.
//
// Раньше стояло disableHardwareAcceleration — так стенд ровнее вёл себя на
// сборочной машине. Но с окном-страницей проверять стало нечего: без GPU у
// плагина нет ни webgl, ни webgpu, и «проверка graphics» проходила бы на
// программном отрисовщике, ничего не проверяя. Замерено пробой: с ускорением
// navigator.gpu отдаёт настоящий адаптер и устройство, без него — ничего.
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 180000)

// Свой самоподписанный сертификат — принимаем, но ТОЛЬКО его и только для
// своего адреса. Иначе проверка тихо разрешала бы дырявые соединения куда
// угодно, а это ровно то, от чего защищает netGuard.
app.on('certificate-error', (event, _wc, url, _err, _cert, callback) => {
  if (url.startsWith('https://' + HOST + ':' + PORT) || url.startsWith('wss://' + HOST + ':' + PORT)) {
    event.preventDefault()
    callback(true)
  } else callback(false)
})

server.listen(PORT, HOST, async () => {
  await app.whenReady()
  const win = new BrowserWindow({ show: true, width: 900, height: 800, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))

  // v1.487.0: настоящая мышь по просьбе из страницы.
  //
  // Зачем это здесь, а не в самой проверке. Событие, собранное руками
  // (dispatchEvent), проходит через обработчики — но НЕ двигает указатель. А
  // безрамочное окно тем и живёт, что шапка у него появляется при наведении:
  // правило :hover ставит браузер по настоящему положению мыши, и подделать
  // его из страницы нельзя никак. Проверить «шапка возвращается, когда
  // подводишь» можно только настоящим вводом, и он бывает только отсюда.
  let lastMouse = 0
  const mousePump = setInterval(async () => {
    try {
      const raw = await win.webContents.executeJavaScript(
        'window.__mouseReq ? JSON.stringify(window.__mouseReq) : ""')
      if (!raw) return
      const q = JSON.parse(raw)
      if (q.n <= lastMouse) return
      lastMouse = q.n
      if (q.kind === 'keyDown' || q.kind === 'keyUp' || q.kind === 'char') {
        // Клавиши — тем же мостом: страница плагина обязана их получать, и
        // проверить это можно только настоящим вводом.
        win.webContents.sendInputEvent({ type: q.kind, keyCode: q.key })
      } else {
        win.webContents.sendInputEvent({ type: q.kind, x: q.x, y: q.y, button: 'left', clickCount: 1 })
      }
      await win.webContents.executeJavaScript('window.__mouseAck = ' + q.n)
    } catch { /* страница ещё грузится или уже закрылась */ }
  }, 20)

  for (let i = 0; i < 500; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  clearInterval(mousePump)
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})

server.on('error', e => { console.log('сервер не поднялся: ' + e.message); process.exit(2) })
