// v1.320.0: проверка правил доступа и триггеров на НАСТОЯЩЕМ Postgres — PGlite
// поднимает его прямо в Node, без Docker и без доступа к базе владельца.
//
// Зачем. Про запрет в базе нельзя сказать «должно работать»: он либо есть, либо
// его нет, а разница видна только когда запрос идёт мимо приложения — то есть
// ровно в том случае, ради которого запрет и написан. Здесь такие запросы и
// посылаются, от лица разных людей.
//
// Что проверяется сейчас: форумы (supabase/81_forums.sql) и то, на что они
// опираются, — ветки (70) и канал только для чтения (78).
//
// Чем ломать: SABOTAGE=<имя> портит в миграции ровно одну защиту, и тогда
// соответствующая проверка обязана провалиться. Проверка, которая не умеет
// падать, ничего не проверяет:
//   SABOTAGE=bump|update|pin|locked|privacy npm run test:db
//
// Осторожно: setup.sql держит СВОИ копии servers/channels/messages и хелперов
// is_member/server_permissions/can_view_channel. Меняешь их в миграциях — поправь
// и там, иначе тест продолжит проверять вчерашнюю базу и радостно зеленеть.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', 'supabase') + '/'
const db = new PGlite()

let pass = 0, fail = 0
function ok(name) { pass++; console.log('OK   ' + name) }
function bad(name, why) { fail++; console.log('ПРОВАЛ ' + name + (why ? ' — ' + why : '')) }
async function check(name, fn) {
  try { const r = await fn(); if (r === false) bad(name); else ok(name) }
  catch (e) { bad(name, e.message) }
}
/** Ожидаем, что действие будет отвергнуто базой. */
async function refused(name, fn) {
  try { await fn(); bad(name, 'прошло, хотя должно быть отвергнуто') }
  catch { ok(name) }
}

const sql = f => readFileSync(REPO + f, 'utf8')

await db.exec(readFileSync(join(HERE, 'setup.sql'), 'utf8'))
await db.exec(sql('70_threads.sql'))
await db.exec(sql('78_channel_readonly.sql'))
const SABOTAGE = {
  // Сторож перестаёт пропускать триггер счётчиков.
  bump: [/if coalesce\(current_setting\('ponoi\.thread_bump'[\s\S]*?end if;/, ''],
  // Правку ветки снова разрешаем любому участнику.
  update: [/using \(is_member\(server_id\) and \(created_by = auth\.uid\(\)[\s\S]*?thread_is_moderator\(server_id, auth\.uid\(\)\)\)\)\n  with check[\s\S]*?thread_is_moderator\(server_id, auth\.uid\(\)\)\)\);/,
           'using (is_member(server_id)) with check (is_member(server_id));'],
  // Сторож перестаёт защищать pinned/locked от автора.
  pin: [/if not public\.thread_is_moderator\(old\.server_id, auth\.uid\(\)\) then[\s\S]*?end if;\n  return new;/, 'return new;'],
  // Запрет писать в закрытое обсуждение убираем.
  locked: [/\n  and \(messages\.thread_id is null or public\.thread_can_post\(messages\.thread_id, auth\.uid\(\)\)\)/, ''],
  // Ветки приватного канала снова видны всем участникам сервера.
  privacy: [/using \(is_member\(server_id\) and public\.can_view_channel\(channel_id, auth\.uid\(\)\)\);/, 'using (is_member(server_id));'],
}
let sql81 = sql('81_forums.sql')
if (process.env.SABOTAGE) {
  const s = SABOTAGE[process.env.SABOTAGE]
  if (!s) { console.error('нет такой поломки: ' + process.env.SABOTAGE); process.exit(2) }
  const next = sql81.replace(s[0], s[1])
  if (next === sql81) { console.error('поломка ничего не заменила — текст миграции изменился'); process.exit(2) }
  sql81 = next
  console.log('СЛОМАНО НАРОЧНО: ' + process.env.SABOTAGE)
}
await db.exec(sql81)
// threads появляется только в 70, поэтому права выдаём после миграций.
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
               grant execute on all functions in schema public to authenticated;`)
console.log('миграции 70, 78 и 81 применились без ошибок\n')

// ── Данные ────────────────────────────────────────────────────────────────
const OWNER = '11111111-1111-1111-1111-111111111111'
const MOD   = '22222222-2222-2222-2222-222222222222'
const USER  = '33333333-3333-3333-3333-333333333333'
const OTHER = '44444444-4444-4444-4444-444444444444'
for (const u of [OWNER, MOD, USER, OTHER]) await db.query('insert into auth.users values ($1)', [u])

const srv = (await db.query('insert into servers (name, owner) values ($1,$2) returning id', ['S', OWNER])).rows[0].id
const role = (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,$3) returning id', [srv, 'mod', 32])).rows[0].id
for (const u of [OWNER, MOD, USER, OTHER])
  await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, u, 'n'])
await db.query('insert into member_roles values ($1,$2,$3)', [srv, MOD, role])

const forum = (await db.query(`insert into channels (server_id, name, kind) values ($1,'форум','forum') returning id`, [srv])).rows[0].id
const priv = (await db.query(`insert into channels (server_id, name, settings) values ($1,'секрет','{"private":true}'::jsonb) returning id`, [srv])).rows[0].id
const ro = (await db.query(`insert into channels (server_id, name, settings) values ($1,'объявления','{"perms":{"send":"deny"}}'::jsonb) returning id`, [srv])).rows[0].id

/** Выполнить как обычный участник с включённым RLS. */
async function as(uid, q, params = []) {
  await db.exec('set role authenticated')
  await db.query(`select set_config('test.uid', $1, false)`, [uid])
  try { return await db.query(q, params) }
  finally { await db.exec('reset role') }
}

// ── Счётчики ──────────────────────────────────────────────────────────────
const t1 = (await as(USER,
  `insert into threads (channel_id, server_id, name, created_by, created_by_name)
   values ($1,$2,'первое обсуждение',$3,'n') returning id, reply_count, last_activity`,
  [forum, srv, USER])).rows[0]

await check('новое обсуждение начинается с нуля ответов', () => t1.reply_count === 0)

const m1 = (await as(USER,
  `insert into messages (channel_id, thread_id, author, author_name, content) values ($1,$2,$3,'n','привет') returning id`,
  [forum, t1.id, USER])).rows[0].id
await as(OTHER,
  `insert into messages (channel_id, thread_id, author, author_name, content) values ($1,$2,$3,'n','и тебе') returning id`,
  [forum, t1.id, OTHER])

let row = (await db.query('select * from threads where id=$1', [t1.id])).rows[0]
await check('ответы считаются триггером базы', () => row.reply_count === 2)
await check('время последней активности сдвинулось', () => new Date(row.last_activity) > new Date(t1.last_activity))

await db.query('delete from messages where id=$1', [m1])
row = (await db.query('select reply_count from threads where id=$1', [t1.id])).rows[0]
await check('удалённый ответ убавляет счётчик', () => row.reply_count === 1)

// ── Подделка порядка в списке ─────────────────────────────────────────────
const before = (await db.query('select last_activity, reply_count from threads where id=$1', [t1.id])).rows[0]
await as(USER, `update threads set last_activity = now() + interval '10 years', reply_count = 9999 where id=$1`, [t1.id])
row = (await db.query('select last_activity, reply_count from threads where id=$1', [t1.id])).rows[0]
await check('автор не может поднять своё обсуждение, переписав время активности',
  () => String(row.last_activity) === String(before.last_activity) && row.reply_count === before.reply_count)

// ── Кто что может ─────────────────────────────────────────────────────────
await as(USER, `update threads set name='переименовал себе' where id=$1`, [t1.id])
row = (await db.query('select name from threads where id=$1', [t1.id])).rows[0]
await check('автор переименовывает своё обсуждение', () => row.name === 'переименовал себе')

await as(OTHER, `update threads set name='угнал чужое' where id=$1`, [t1.id])
row = (await db.query('select name from threads where id=$1', [t1.id])).rows[0]
await check('посторонний не переименует чужое обсуждение', () => row.name === 'переименовал себе')

await as(USER, `update threads set pinned = true where id=$1`, [t1.id])
row = (await db.query('select pinned from threads where id=$1', [t1.id])).rows[0]
await check('автор не может закрепить сам себя наверху', () => row.pinned === false)

await as(MOD, `update threads set pinned = true where id=$1`, [t1.id])
row = (await db.query('select pinned from threads where id=$1', [t1.id])).rows[0]
await check('модератор закрепляет обсуждение', () => row.pinned === true)

await as(USER, `update threads set server_id = $2 where id=$1`, [t1.id, srv])
await as(USER, `update threads set created_by = $2 where id=$1`, [t1.id, OTHER])
row = (await db.query('select created_by from threads where id=$1', [t1.id])).rows[0]
await check('автора обсуждения не подменить', () => row.created_by === USER)

// ── Закрытое обсуждение ───────────────────────────────────────────────────
await as(MOD, `update threads set locked = true where id=$1`, [t1.id])
await refused('в закрытое обсуждение обычный участник не напишет', () => as(USER,
  `insert into messages (channel_id, thread_id, author, author_name, content) values ($1,$2,$3,'n','всё равно напишу')`,
  [forum, t1.id, USER]))
await check('модератор в закрытое обсуждение пишет', async () => {
  await as(MOD, `insert into messages (channel_id, thread_id, author, author_name, content) values ($1,$2,$3,'n','итог')`,
    [forum, t1.id, MOD])
  return true
})
await as(MOD, `update threads set locked = false where id=$1`, [t1.id])

// ── Канал только для чтения ───────────────────────────────────────────────
await refused('в канале только для чтения обсуждение не завести', () => as(USER,
  `insert into threads (channel_id, server_id, name, created_by, created_by_name) values ($1,$2,'обход',$3,'n')`,
  [ro, srv, USER]))
await check('в канале только для чтения обсуждение заводит владелец', async () => {
  await as(OWNER, `insert into threads (channel_id, server_id, name, created_by, created_by_name) values ($1,$2,'объявление',$3,'n')`,
    [ro, srv, OWNER])
  return true
})

// ── Приватный канал ───────────────────────────────────────────────────────
await as(OWNER, `insert into threads (channel_id, server_id, name, created_by, created_by_name) values ($1,$2,'зарплаты',$3,'n')`,
  [priv, srv, OWNER])
const seenByUser = (await as(USER, `select name from threads where channel_id=$1`, [priv])).rows
await check('названия обсуждений приватного канала посторонний не видит', () => seenByUser.length === 0)
const seenByOwner = (await as(OWNER, `select name from threads where channel_id=$1`, [priv])).rows
await check('владелец свой приватный канал видит', () => seenByOwner.length === 1)

// ── Удаление ──────────────────────────────────────────────────────────────
const t2 = (await as(USER, `insert into threads (channel_id, server_id, name, created_by, created_by_name)
  values ($1,$2,'на удаление',$3,'n') returning id`, [forum, srv, USER])).rows[0].id
await as(OTHER, `delete from threads where id=$1`, [t2])
await check('посторонний не удалит чужое обсуждение',
  async () => (await db.query('select 1 from threads where id=$1', [t2])).rows.length === 1)
await as(USER, `delete from threads where id=$1`, [t2])
await check('автор удаляет своё обсуждение',
  async () => (await db.query('select 1 from threads where id=$1', [t2])).rows.length === 0)

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
