// v1.458.0: приложение САМО узнаёт, где человек в игре.
//
// Что было и почему это никуда не годилось. Прохождение приходилось вбивать
// руками: вставь список миссий, отмечай галочки. Владелец на это справедливо
// ругнулся — он просил систему, которая смотрит сама.
//
// Откуда берутся настоящие данные. У Steam на каждую игру есть список
// достижений, и у каждого достижения — название, описание, картинка и отметка
// «получено». Это ровно то, что нужно: реальные вехи прохождения именно ЭТОГО
// человека, а не выдуманный мной список. Лежит по открытому адресу:
//
//     https://steamcommunity.com/profiles/<steamid64>/stats/<appid>/?xml=1&l=russian
//
// Ключа не нужно. Нужен публичный профиль Steam — если он закрыт, Steam ничего
// не отдаёт, и мы честно говорим об этом, а не выдумываем.
//
// Почему в Electron, а не в самой странице. Steam не разрешает браузеру читать
// свои ответы (CORS) — из окна приложения такой запрос просто не состоится.
// Главный процесс этим не связан.
//
// appid берём из того же манифеста Steam, по которому уже узнаём настоящее
// название игры (см. steamName.cjs) — то есть по одному пути к exe получаем и
// имя, и номер игры.
//
// Проверки: npm run test:games.
const https = require('https')

/** Достать appid из имени файла манифеста: appmanifest_1091500.acf */
function appIdFromManifest(file) {
  const m = String(file || '').match(/^appmanifest_(\d+)\.acf$/i)
  return m ? m[1] : null
}

/**
 * Разбор ответа Steam. XML простой и предсказуемый:
 *   <achievement closed="1"><iconClosed>…</iconClosed><name>…</name>
 *   <description>…</description><unlockTimestamp>…</unlockTimestamp></achievement>
 *
 * Разбором строкой, а не XML-библиотекой: тащить парсер ради четырёх полей
 * незачем, а формат Steam не менялся годами.
 */
function parseAchievements(xml) {
  const text = String(xml || '')
  const out = []
  for (const m of text.matchAll(/<achievement[^>]*closed=["'](\d)["'][^>]*>([\s\S]*?)<\/achievement>/gi)) {
    const closed = m[1] === '1'
    const body = m[2]
    const поле = (n) => {
      const r = body.match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>', 'i'))
      if (!r) return ''
      return r[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .trim()
    }
    const name = поле('name')
    if (!name) continue
    const ts = Number(поле('unlockTimestamp')) || 0
    out.push({
      name,
      desc: поле('description'),
      icon: поле(closed ? 'iconClosed' : 'iconOpen') || поле('iconClosed'),
      done: closed,
      at: ts ? ts * 1000 : 0,
    })
  }
  return out
}

/** Закрыт ли профиль — Steam отвечает страницей с этим признаком. */
function isPrivate(xml) {
  const t = String(xml || '')
  return /<privacyState>\s*(private|friendsonly)/i.test(t) || /<error>/i.test(t)
}

function fetchXml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Ponoi' }, timeout: 15000 }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return fetchXml(res.headers.location).then(resolve, reject)
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Steam ответил ' + res.statusCode)) }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => { data += c; if (data.length > 4 * 1024 * 1024) req.destroy() })
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => req.destroy(new Error('Steam не ответил за 15 с')))
    req.on('error', reject)
  })
}

/**
 * Вехи прохождения по игре. Возвращает { ok, items } либо { ok: false, why }.
 * Почему не бросаем: панель должна показать причину, а не пустоту.
 */
async function steamAchievements(steamId64, appId, fetcher = fetchXml) {
  if (!/^\d{17}$/.test(String(steamId64 || ''))) return { ok: false, why: 'no-steamid' }
  if (!/^\d+$/.test(String(appId || ''))) return { ok: false, why: 'no-appid' }
  let xml
  try {
    xml = await fetcher('https://steamcommunity.com/profiles/' + steamId64 + '/stats/' + appId + '/?xml=1&l=russian')
  } catch (e) {
    return { ok: false, why: 'net', detail: e && e.message }
  }
  if (isPrivate(xml)) return { ok: false, why: 'private' }
  const items = parseAchievements(xml)
  if (items.length === 0) return { ok: false, why: 'empty' }
  return { ok: true, items }
}

module.exports = { appIdFromManifest, parseAchievements, isPrivate, steamAchievements }
