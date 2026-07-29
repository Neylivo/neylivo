// Живая проверка поиска текста: npm run check:lyrics
//
// В общий прогон проверок это не входит намеренно — здесь настоящий запрос в
// интернет, а проверка, которая падает от чужого сервера или отсутствия сети,
// перестаёт что-либо значить. Зато глазами убедиться, что поиск и правда
// находит, можно только так: разбор и выбор записи проверяются отдельно
// (npm run test:lyrics), а вот попадание в каталог — нет.
//
// Названия взяты в том виде, в каком они лежат в Трекотеке: с «(Official Video)»,
// без исполнителя, с исполнителем внутри названия.
import { execSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist-lyrics-live', { recursive: true })
execSync('npx esbuild src/music/lyrics.ts --bundle --platform=node --format=esm ' +
  '--outfile=dist-lyrics-live/l.mjs ' +
  '--define:import.meta.env={\\"VITE_SUPABASE_URL\\":\\"https://example.supabase.co\\",\\"VITE_SUPABASE_ANON_KEY\\":\\"test\\"}',
  { stdio: 'inherit' })

const { searchLyricsOnline, parseLyrics } = await import('./../dist-lyrics-live/l.mjs')

const CASES = [
  ['Linkin Park - Numb (Official Video)', '', undefined],
  ['Numb', 'Linkin Park', 187],
  ['Believer', '', undefined],
  ['Кино - Группа крови', '', undefined],
  ['Носорог', 'Мумий Тролль', undefined],
  ['bohemian rhapsody [remastered 2011]', 'Queen', undefined],
]

let found = 0
for (const [title, artist, dur] of CASES) {
  const r = await searchLyricsOnline(title, artist, dur)
  if (r.ok) {
    const l = parseLyrics(r.hit.text)
    found++
    console.log('  нашлось  ' + JSON.stringify(title).padEnd(42) + ' → ' + r.hit.by +
      '  (строк: ' + l.lines.length + ', караоке: ' + (l.synced ? 'да' : 'нет') + ')')
  } else {
    console.log('  НЕТ      ' + JSON.stringify(title).padEnd(42) + ' → ' + (r.why === 'net' ? 'связь' : 'в каталоге нет'))
  }
}
console.log('\nИТОГ: нашлось ' + found + ' из ' + CASES.length)
