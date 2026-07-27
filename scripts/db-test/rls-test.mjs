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
// 49 заводит base_permissions (права @everyone) и политики, которые их требуют;
// 72 потом помечает server_permissions как security definer. Порядок тот же, что
// в истории проекта.
await db.exec(sql('49_role_perms2.sql'))
await db.exec(sql('72_harden_permission_functions.sql'))
// 64 заводит правило «участник правит только свою строку» и триггер-сторож —
// 82 его расширяет, поэтому исходный нужен.
await db.exec(sql('64_server_nickname.sql'))
await db.exec(sql('70_threads.sql'))
await db.exec(sql('78_channel_readonly.sql'))
// ВАЖНО про поломки политик. Каждая новая миграция объявляет messages_insert
// заново и целиком — так принято в этом проекте (78, 81, 82, 83). Значит поломка,
// применённая только к одной миграции, окажется холостой: следующая перезапишет
// политику целиком и вернёт запрет на место, а проверка радостно позеленеет.
// Дважды за сессию так и вышло: сначала «locked» перестал ловиться с появлением
// 82, потом «locked» и «rules» — с появлением 83.
// Поэтому поломка применяется КО ВСЕМ миграциям, где встречается её текст.
const SABOTAGE = {
  // Сторож перестаёт пропускать триггер счётчиков.
  bump: [/if coalesce\(current_setting\('ponoi\.thread_bump'[\s\S]*?end if;/, ''],
  // Правку ветки снова разрешаем любому участнику.
  update: [/using \(is_member\(server_id\) and \(created_by = auth\.uid\(\)[\s\S]*?thread_is_moderator\(server_id, auth\.uid\(\)\)\)\)\n  with check[\s\S]*?thread_is_moderator\(server_id, auth\.uid\(\)\)\)\);/,
           'using (is_member(server_id)) with check (is_member(server_id));'],
  // Сторож перестаёт защищать pinned/locked от автора.
  pin: [/if not public\.thread_is_moderator\(old\.server_id, auth\.uid\(\)\) then[\s\S]*?end if;\n  return new;/, 'return new;'],
  // Ветки приватного канала снова видны всем участникам сервера.
  privacy: [/using \(is_member\(server_id\) and public\.can_view_channel\(channel_id, auth\.uid\(\)\)\);/, 'using (is_member(server_id));'],
  // Запрет писать в закрытое обсуждение форума.
  locked: [/\n  and \(messages\.thread_id is null or public\.thread_can_post\(messages\.thread_id, auth\.uid\(\)\)\)/g, ''],
  // Согласие с правилами перестаёт требоваться.
  rules: [/\n    and public\.server_rules_ok\(c\.server_id, auth\.uid\(\)\)/g, ''],
  // Дату согласия снова присылает клиент.
  rulesdate: [/if new\.rules_accepted_at is distinct from old\.rules_accepted_at then\s*\n\s*new\.rules_accepted_at := now\(\);\s*\n\s*end if;/, ''],
  // Уровень проверки перестаёт что-либо требовать.
  verif: [/\n    and public\.server_verification_ok\(c\.server_id, auth\.uid\(\)\)/g, ''],
  // Ступени перестают быть накопительными — «Высокий» больше не требует почты.
  verifsteps: [/if v_level >= 1 and not coalesce\(v_email_ok, false\) then return false; end if;/, ''],
  // Чужие серверы снова видны всем вошедшим (состояние до 84).
  srvread: [/using \(\n  owner = auth\.uid\(\)\n  or is_member\(id\)\n  or coalesce\(\(settings ->> 'public'\)::boolean, false\)\n\)/, 'using (true)'],
  // Вступить можно и в непубличный сервер.
  joinpub: [/if not v_public then raise exception 'server_not_found'; end if;/, ''],
  // Управление вебхуками снова выдано всем по умолчанию (лишний бит 512).
  basebit: [/alter table public\.servers alter column base_permissions set default 15360;\s*\nupdate public\.servers set base_permissions = base_permissions & ~512\s*\n where \(base_permissions & 512\) <> 0;/, ''],
  // Вебхуки снова проверяют бит тайм-аута вместо управления вебхуками.
  whbit: [/& 512\) <> 0/g, '& 16384) <> 0'],
  // Эмодзи и стикеры снова удаляет любой участник.
  emoji: [/\s*and \(created_by = auth\.uid\(\) or public\.can_manage_emoji\(server_id, auth\.uid\(\)\)\)/g, ''],
}
const SRC = { 81: sql('81_forums.sql'), 82: sql('82_server_rules.sql'), 83: sql('83_verification_level.sql'), 84: sql('84_public_servers.sql'), 85: sql('85_perm_fixes.sql') }
if (process.env.SABOTAGE) {
  const name = process.env.SABOTAGE
  const s = SABOTAGE[name]
  if (!s) { console.error('нет такой поломки: ' + name); process.exit(2) }
  const hit = []
  for (const k of Object.keys(SRC)) {
    const next = SRC[k].replace(s[0], s[1])
    if (next !== SRC[k]) { SRC[k] = next; hit.push(k) }
  }
  if (hit.length === 0) { console.error('поломка ничего не заменила — текст миграции изменился'); process.exit(2) }
  console.log('СЛОМАНО НАРОЧНО: ' + name + ' (миграции ' + hit.join(', ') + ')')
}
await db.exec(SRC[81])
await db.exec(SRC[82])
await db.exec(SRC[83])
await db.exec(SRC[84])
// 80 и 61 в тесте не применяются целиком (в них есть лишнее для этой песочницы),
// но их политики целиком переобъявляет 85 — проверяем именно итоговые.
await db.exec(SRC[85])
await db.exec('grant usage on schema auth to authenticated; grant select on auth.users to authenticated;')
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
  // Сбрасываем и роль, и «кто я»: иначе следующий запрос от лица администратора
  // (прямой db.query, без as) выполнялся бы с чужим auth.uid() — и, например,
  // триггер enforce_member_self_edit принимал бы правку служебных полей за
  // самовольную правку участника и отклонял её.
  finally { await db.exec(`reset role; select set_config('test.uid', '', false);`) }
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

// ── Права @everyone (servers.base_permissions) ────────────────────────────
// v1.321.0: экран «Права по умолчанию — @everyone» писал в settings.everyone_perms,
// которое не читалось нигде. Настоящие права — эта колонка; здесь проверяется,
// что выключенный бит действительно запрещает действие, а не только красит кнопку.
const DEFAULT_BASE = 15360   // CREATE_INVITE|MENTION_EVERYONE|ADD_REACTIONS|ATTACH_FILES
// 15872 было раньше и включало лишний бит 512 (управление вебхуками) — см. 85.
await check('по умолчанию у @everyone ровно четыре права', async () =>
  (await db.query('select base_permissions::int b from servers where id=$1', [srv])).rows[0].b === DEFAULT_BASE)

const msgForRx = (await as(OWNER,
  `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','на реакцию') returning id`,
  [forum, OWNER])).rows[0].id

async function setBase(bits) { await db.query('update servers set base_permissions=$2 where id=$1', [srv, bits]) }

await check('с правом участник ставит реакцию', async () => {
  await as(USER, `insert into reactions (message_id, user_id, emoji) values ($1,$2,'👍')`, [msgForRx, USER])
  return true
})
await setBase(DEFAULT_BASE & ~4096)   // отобрали ADD_REACTIONS
await refused('без права реакцию поставить нельзя', () => as(OTHER,
  `insert into reactions (message_id, user_id, emoji) values ($1,$2,'👎')`, [msgForRx, OTHER]))
await check('у владельца реакции работают и без права', async () => {
  await as(OWNER, `insert into reactions (message_id, user_id, emoji) values ($1,$2,'🔥')`, [msgForRx, OWNER])
  return true
})

await setBase(DEFAULT_BASE & ~8192)   // отобрали ATTACH_FILES
await refused('без права вложение не отправить', () => as(USER,
  `insert into messages (channel_id, author, author_name, content, attach_url) values ($1,$2,'n','вот файл','https://x/y.png')`,
  [forum, USER]))
await check('текст без вложения при этом отправляется', async () => {
  await as(USER, `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','просто текст')`, [forum, USER])
  return true
})

await setBase(DEFAULT_BASE & ~1024)   // отобрали CREATE_INVITE
await refused('без права приглашение не создать', () => as(USER,
  `insert into server_invites (server_id, code, created_by) values ($1,'abc',$2)`, [srv, USER]))
await setBase(DEFAULT_BASE)
await check('вернули право — приглашение создаётся', async () => {
  await as(USER, `insert into server_invites (server_id, code, created_by) values ($1,'def',$2)`, [srv, USER])
  return true
})

// ── Правила сервера (82) ──────────────────────────────────────────────────
// v1.322.0: раньше переключатель «Правила сервера» и сам их список нигде не
// читались. Теперь без согласия нельзя ни писать, ни заводить обсуждения, ни
// ставить реакции — проверяется здесь запросами мимо приложения.
await db.query(`update servers set settings = jsonb_build_object(
  'rules_on', true, 'rules', to_jsonb(array['Будьте вежливы']), 'rules_at', now()::text) where id=$1`, [srv])
await db.query(`update server_members set rules_accepted_at = null where server_id=$1 and user_id=$2`, [srv, USER])

await refused('без согласия с правилами писать нельзя', () => as(USER,
  `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','привет')`, [forum, USER]))
await refused('без согласия нельзя завести обсуждение', () => as(USER,
  `insert into threads (channel_id, server_id, name, created_by, created_by_name) values ($1,$2,'тема',$3,'n')`,
  [forum, srv, USER]))
await refused('без согласия нельзя поставить реакцию', () => as(USER,
  `insert into reactions (message_id, user_id, emoji) values ($1,$2,'👍')`, [msgForRx, USER]))
await check('владельца собственные правила не запирают', async () => {
  await as(OWNER, `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','я владелец')`, [forum, OWNER])
  return true
})

await as(USER, `update server_members set rules_accepted_at = now() where server_id=$1 and user_id=$2`, [srv, USER])
await check('после согласия писать можно', async () => {
  await as(USER, `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','согласился')`, [forum, USER])
  return true
})

await check('дату согласия ставит база, а не клиент', async () => {
  await as(USER, `update server_members set rules_accepted_at = now() + interval '50 years' where server_id=$1 and user_id=$2`, [srv, USER])
  const got = (await db.query(`select rules_accepted_at from server_members where server_id=$1 and user_id=$2`, [srv, USER])).rows[0]
  return new Date(got.rules_accepted_at).getFullYear() < new Date().getFullYear() + 2
})

// Владелец переписал правила — согласие обнуляется само.
await db.query(`update servers set settings = jsonb_set(settings, '{rules_at}', to_jsonb((now() + interval '1 minute')::text)) where id=$1`, [srv])
await refused('изменённые правила требуют согласия заново', () => as(USER,
  `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','а я и не читал')`, [forum, USER]))

await db.query(`update servers set settings = jsonb_set(settings, '{rules_on}', 'false') where id=$1`, [srv])
await check('выключенные правила никого не держат', async () => {
  await as(USER, `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n','правил нет')`, [forum, USER])
  return true
})

// ── Уровень проверки участников (83) ──────────────────────────────────────
// v1.322.0: пять ступеней, которые раньше только сохранялись. Проверяем каждую
// и то, что роль и владение сервером снимают ограничение.
async function setLevel(n) {
  await db.query(`update servers set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{verification}', to_jsonb($2::int)) where id=$1`, [srv, n])
}
async function write(uid, text) {
  return as(uid, `insert into messages (channel_id, author, author_name, content) values ($1,$2,'n',$3)`, [forum, uid, text])
}
// OTHER: почта не подтверждена, учётка только что создана, роли нет.
await db.query(`update auth.users set email_confirmed_at = null, created_at = now() where id=$1`, [OTHER])
await db.query(`update server_members set joined_at = now() where server_id=$1 and user_id=$2`, [srv, OTHER])

await setLevel(0)
await check('ступень «Отсутствует» никого не держит', async () => { await write(OTHER, 'ноль'); return true })

await setLevel(1)
await refused('«Низкий» не пускает без подтверждённой почты', () => write(OTHER, 'низкий'))
await db.query(`update auth.users set email_confirmed_at = now() where id=$1`, [OTHER])
await check('с подтверждённой почтой «Низкий» пропускает', async () => { await write(OTHER, 'почта есть'); return true })

await setLevel(2)
await refused('«Средний» не пускает совсем свежую учётную запись', () => write(OTHER, 'средний'))
await db.query(`update auth.users set created_at = now() - interval '1 hour' where id=$1`, [OTHER])
await check('учётной записи час — «Средний» пропускает', async () => { await write(OTHER, 'я тут давно'); return true })

await setLevel(3)
await refused('«Высокий» не пускает только что вступившего', () => write(OTHER, 'высокий'))
await db.query(`update server_members set joined_at = now() - interval '1 hour' where server_id=$1 and user_id=$2`, [srv, OTHER])
await check('час на сервере — «Высокий» пропускает', async () => { await write(OTHER, 'освоился'); return true })

await setLevel(4)
await refused('«Наивысший» не пускает без подтверждённого телефона', () => write(OTHER, 'наивысший'))
await check('владельца уровень проверки не касается', async () => { await write(OWNER, 'я владелец'); return true })
await check('участника с ролью уровень проверки не касается', async () => { await write(MOD, 'у меня роль'); return true })
await db.query(`update auth.users set phone_confirmed_at = now() where id=$1`, [OTHER])
await check('с подтверждённым телефоном «Наивысший» пропускает', async () => { await write(OTHER, 'телефон есть'); return true })
await setLevel(0)

// ── Видимость серверов и вступление в публичные (84) ──────────────────────
// v1.324.0: миграция 76 открыла чтение таблицы servers всем вошедшим, из-за чего
// в «Путешествии по серверам» лежали чужие и служебные серверы. Проверяем, что
// чужой закрытый сервер снова не читается, а публичный — читается и пускает.
const stranger = '55555555-5555-5555-5555-555555555555'
await db.query('insert into auth.users (id) values ($1)', [stranger])
const closed = (await db.query('insert into servers (name, owner) values ($1,$2) returning id', ['Закрытый', OWNER])).rows[0].id
const open = (await db.query(`insert into servers (name, owner, settings) values ($1,$2,'{"public":true}'::jsonb) returning id`, ['Открытый', OWNER])).rows[0].id

await check('чужой закрытый сервер посторонний не видит', async () =>
  (await as(stranger, 'select id from servers where id=$1', [closed])).rows.length === 0)
await check('публичный сервер виден всем', async () =>
  (await as(stranger, 'select id from servers where id=$1', [open])).rows.length === 1)
await check('свой сервер владелец видит', async () =>
  (await as(OWNER, 'select id from servers where id=$1', [closed])).rows.length === 1)
await check('участник видит сервер, где состоит', async () =>
  (await as(USER, 'select id from servers where id=$1', [srv])).rows.length === 1)

await check('в публичный сервер можно войти без приглашения', async () => {
  await as(stranger, `select join_public_server($1,'n')`, [open])
  return (await db.query('select 1 from server_members where server_id=$1 and user_id=$2', [open, stranger])).rows.length === 1
})
await refused('в закрытый сервер так не войти', () => as(stranger, `select join_public_server($1,'n')`, [closed]))
await db.query(`update servers set settings = settings || '{"invites_paused":true}'::jsonb where id=$1`, [open])
await refused('при приостановленных приглашениях в публичный не войти', () => as(OTHER, `select join_public_server($1,'n')`, [open]))
await db.query(`update servers set settings = settings - 'invites_paused' where id=$1`, [open])
await db.query('insert into server_bans values ($1,$2)', [open, OTHER])
await refused('забаненный в публичный сервер не войдёт', () => as(OTHER, `select join_public_server($1,'n')`, [open]))

// ── Вебхуки и эмодзи: права проверялись не тем битом (85) ─────────────────
// v1.326.0: 80_webhooks.sql проверял бит 16384 (тайм-аут) вместо 512
// (управление вебхуками), а удаление эмодзи и стикеров не проверяло ничего,
// кроме членства.
const rTimeout = (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,16384) returning id', [srv, 'таймаут'])).rows[0].id
const rHooks = (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,512) returning id', [srv, 'вебхуки'])).rows[0].id
const rEmoji = (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,128) returning id', [srv, 'эмодзи'])).rows[0].id
await db.query('insert into member_roles values ($1,$2,$3)', [srv, USER, rTimeout])
await db.query('insert into member_roles values ($1,$2,$3)', [srv, OTHER, rHooks])

const wh = (row, uid) => as(uid, `insert into webhooks (channel_id, server_id, name, token_hash, created_by) values ($1,$2,$3,'h',$4)`, row)
await refused('право «тайм-аут» больше не даёт заводить вебхуки', () =>
  wh([forum, srv, 'от таймаутчика', USER], USER))
await check('право «управление вебхуками» вебхук заводит', async () => {
  await wh([forum, srv, 'законный', OTHER], OTHER); return true
})

await db.query(`insert into server_emoji (server_id, name, url, created_by) values ($1,'pepe','u',$2)`, [srv, OWNER])
// DELETE под запретом правила доступа не бросает ошибку — он просто не находит
// строк. Поэтому здесь проверяем не отказ, а то, что строка на месте.
await check('посторонний участник не удалит эмодзи сервера', async () => {
  await as(USER, `delete from server_emoji where server_id=$1`, [srv])
  return (await db.query('select 1 from server_emoji where server_id=$1', [srv])).rows.length === 1
})
await db.query('insert into member_roles values ($1,$2,$3)', [srv, USER, rEmoji])
await check('с правом «управление эмодзи» удаление работает', async () => {
  await as(USER, `delete from server_emoji where server_id=$1`, [srv])
  return (await db.query('select 1 from server_emoji where server_id=$1', [srv])).rows.length === 0
})

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
