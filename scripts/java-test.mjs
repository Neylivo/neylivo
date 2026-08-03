// v1.444.0: сборка нативного кода Android. Запуск: npm run test:java
//
// Зачем. Весь Java-код проекта до сих пор НИ РАЗУ не компилировался: Android SDK
// на машине нет, а установленная java — восьмая, для современного Gradle
// негодная. Опечатка, неверное число доводов или забытый import находились
// только при сборке APK на чужой машине, то есть практически никогда. С каждым
// выпуском такого кода становилось больше: установщик обновлений, полный экран,
// фоновое скачивание, постоянная служба для музыки.
//
// Как. Настоящие файлы `android/app/src/main/java/**` собираются javac против
// заглушек тех классов Android и Capacitor, которые они трогают
// (`scripts/java-stubs/`). Компилятор находится сам: сначала в PATH, потом —
// среди известных мест, где на этой машине лежит JDK.
//
// Чего это НЕ проверяет, и говорить иначе нельзя: заглушки написаны по
// документации, а не взяты из настоящего android.jar. Ошибка в моей сигнатуре
// останется незамеченной, поведение не проверяется вовсе, а проверки версии
// (Build.VERSION.SDK_INT) компилятору безразличны. См. scripts/java-stubs/README.md.
import { execFileSync, execSync } from 'node:child_process'
import { readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'android', 'app', 'src', 'main', 'java')
const STUBS = join(ROOT, 'scripts', 'java-stubs', 'src')

/** Все .java по дереву. */
function javaFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...javaFiles(p))
    else if (name.endsWith('.java')) out.push(p)
  }
  return out
}

/** Где взять javac. PATH — первым: если владелец поставит JDK, найдётся он. */
function findJavac() {
  try {
    execSync('javac -version', { stdio: 'ignore' })
    return 'javac'
  } catch { /* в PATH нет */ }
  // JDK, приезжающие с продуктами JetBrains, и обычные места установки.
  const guesses = []
  for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
    if (!base) continue
    for (const vendor of ['JetBrains', 'Java', 'Eclipse Adoptium', 'Android\\Android Studio']) {
      const dir = join(base, vendor)
      let names = []
      try { names = readdirSync(dir) } catch { continue }
      for (const n of names) {
        guesses.push(join(dir, n, 'jbr', 'bin', 'javac.exe'))
        guesses.push(join(dir, n, 'bin', 'javac.exe'))
      }
    }
  }
  for (const g of guesses) {
    try { statSync(g); return g } catch { /* нет такого */ }
  }
  return null
}

const javac = findJavac()
if (!javac) {
  // Не провал: на машине без JDK проверять нечем, и валить из-за этого весь
  // прогон нельзя. Но и молчать нельзя — иначе «прошло» будет означать
  // «ничего не проверялось».
  console.log('ПРОПУЩЕНО: javac не найден — нативный код НЕ проверялся')
  process.exit(0)
}

const files = javaFiles(SRC)
const stubs = javaFiles(STUBS)
console.log('── Сборка нативного кода Android ──')
console.log('  компилятор : ' + javac)
console.log('  файлов     : ' + files.length + ' своих, ' + stubs.length + ' заглушек')

const out = mkdtempSync(join(tmpdir(), 'ponoi-java-'))
try {
  execFileSync(javac, [
    '-nowarn',
    // Заглушки без тел: предупреждения о непроверенных приведениях не нужны.
    '-Xlint:none',
    '-proc:none',
    '-encoding', 'UTF-8',
    '-d', out,
    ...stubs, ...files,
  ], { stdio: 'pipe', encoding: 'utf8' })
  console.log('\nИТОГ: нативный код собирается')
  process.exit(0)
} catch (e) {
  const text = (e.stderr || '') + (e.stdout || '')
  console.log('\nПРОВАЛ: нативный код не собирается\n')
  console.log(text.trim())
  process.exit(1)
} finally {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* временная папка */ }
}
