// v1.357.0: прогон проверок переводчика интерфейса. Запуск: npm run test:i18n
//
// В настоящем окне, а не в Node: переводчик ходит по готовому DOM и следит за
// новыми узлами через MutationObserver — ни того, ни другого в Node нет, а вся
// суть проверки в том, что он пропустит, а что тронет.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const OUT = path.join(__dirname, '..', 'dist-i18n-test')
if (!fs.existsSync(path.join(OUT, 't.js'))) {
  console.error('нет собранного теста — запускай через npm run test:i18n')
  process.exit(1)
}
fs.writeFileSync(path.join(OUT, 'index.html'),
  '<!doctype html><meta charset=utf-8><pre id=out>идёт…</pre><script src="t.js"></script>')

// Список классов легко протухнет: компонент переименуют, класс исчезнет, а
// строка в i18n.ts останется — и защита тихо перестанет действовать, оставаясь
// на вид целой. Поэтому сверяем список с разметкой прямо тут, до окна.
const SRC = path.join(__dirname, '..', 'src')
function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? allFiles(path.join(dir, d.name)) : [path.join(dir, d.name)])
}
{
  const i18nSrc = fs.readFileSync(path.join(SRC, 'lib', 'i18n.ts'), 'utf8')
  const block = /const UGC_CLASSES = \[([^\]]*)\]/.exec(i18nSrc)
  if (!block) { console.error('не нашёлся список UGC_CLASSES в src/lib/i18n.ts'); process.exit(1) }
  const classes = (block[1].match(/'[a-z0-9-]+'/g) || []).map(x => x.slice(1, -1))
  const markup = allFiles(SRC)
    .filter(f => /\.tsx?$/.test(f) && !f.includes('__'))
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n')
  const dead = classes.filter(c => !markup.includes(c))
  if (dead.length) {
    console.error('  ПРОВАЛ классы из списка нигде не встречаются в разметке: ' + dead.join(', '))
    process.exit(1)
  }
  console.log('классов помечено как «чужой текст»: ' + classes.length + ', все найдены в разметке')
}

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС — проверки не завершились'); process.exit(2) }, 90000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(OUT, 'index.html'))
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await win.webContents.executeJavaScript('!!window.__done')) break
  }
  console.log(await win.webContents.executeJavaScript("document.getElementById('out').textContent"))
  const failed = await win.webContents.executeJavaScript('window.__failed || 0')
  process.exit(failed ? 1 : 0)
})
