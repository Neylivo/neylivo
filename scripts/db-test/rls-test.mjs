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
  // Строчка о вступлении перестаёт писаться.
  joinmsg: [/if v_new then perform public\.post_join_message\(.*?\); end if;/g, ''],
  // Приватный канал снова годится под системные сообщения.
  joinpriv: [/and not coalesce\(\(c\.settings ->> 'private'\)::boolean, false\)/, ''],
  // Владельца сервера снова может назначить кто угодно с «Управлением сервером».
  takeover: [/if new\.owner is distinct from old\.owner and auth\.uid\(\) is distinct from old\.owner then\s*\n\s*raise exception 'only_owner_can_transfer';\s*\n\s*end if;/, ''],
  // Канал снова заводит любой участник (состояние до 87).
  chins: [/create policy "channels_insert" on public\.channels for insert to authenticated with check \([\s\S]*?\n\);/,
          'create policy "channels_insert" on public.channels for insert to authenticated with check (is_member(server_id));'],
  // Раздать можно снова любое право, а не только своё.
  grant: [/and \(p_mask & ~public\.server_permissions\(p_server, p_user\)\) = 0/, ''],
  // Роль с чужого сервера снова засчитывается в правах.
  foreign: [/and sr\.server_id = p_server/g, ''],
  // Роль с чужого сервера снова можно выдать участнику.
  mrforeign: [/\n       and r\.server_id = member_roles\.server_id/, ''],
  // «Управление событиями» снова ничего не значит.
  events: [/\n    or \(public\.server_permissions\(server_events\.server_id, auth\.uid\(\)\) & 256\) <> 0/, ''],
  // Чужое кастом-эмодзи снова переписывает любой.
  cemoji: [/using \(owner = auth\.uid\(\) or owner is null\) with check \(owner = auth\.uid\(\)\)/, 'using (true) with check (true)'],
  // В общий кэш обложек снова кладётся любой адрес.
  cover: [/check \(cover_url is null or cover_url like 'https:\/\/%'\)/, 'check (true)'],
  // Чужие «Мои GIF» снова видно.
  gifs: [/using \(owner = auth\.uid\(\)\);\n/, 'using (true);\n'],
  // Полное состояние до 88: чужие GIF и видно, и можно удалить. Отдельной поломки
  // «только удаление» не бывает: запрет на чтение и так не даёт найти чужую строку,
  // поэтому проверка удаления имеет смысл только когда открыто и то, и другое.
  gifsdel: [/for select to authenticated\n  using \(owner = auth\.uid\(\)\);([\s\S]*?)using \(owner = auth\.uid\(\) or owner is null\);/,
            'for select to authenticated\n  using (true);$1using (true);'],
  // Имя автора в каталоге снова приходит от клиента.
  // \s* вокруг переносов — файлы миграций лежат с CRLF, и голый \n в них не ловится.
  catauthor: [/new\.author_name := coalesce\(\s*\(select coalesce\(nullif\(p\.display_name, ''\), p\.username\) from public\.profiles p where p\.id = auth\.uid\(\)\),\s*'неизвестен'\);/, ''],
  // Автора снова переписывает любая правка — включая счётчик установок.
  catowner: [/new\.author_id := old\.author_id;/, 'new.author_id := auth.uid();'],
  // Профиль чужого бота снова настраивает кто угодно.
  botprof: [/select bot_user_id into v_bot from public\.bot_apps\s*\n\s*where id = p_app and owner_id = auth\.uid\(\);/,
            'select bot_user_id into v_bot from public.bot_apps where id = p_app;'],
  // Аватарке бота снова годится любой адрес.
  botava: [/if p_avatar is not null and p_avatar <> '' and p_avatar !~ '\^https:\/\/' then raise exception 'bad_avatar'; end if;/, ''],
  // Вид встроенного бота снова можно приписать своему боту.
  botkind: [/if tg_op = 'UPDATE' and new\.builtin is distinct from old\.builtin then\s*raise exception 'builtin_is_not_settable';\s*end if;/, ''],
  botrm: [/if v_owner <> auth\.uid\(\) and \(server_permissions\(p_server, auth\.uid\(\)\) & 512\) = 0 then\s*raise exception 'missing_manage_bots';\s*end if;/, ''],
  bothuman: [/if not exists \(select 1 from bot_apps where bot_user_id = p_bot_user\) then\s*raise exception 'not_a_bot';\s*end if;/, ''],
  botkick: [/if exists \(select 1 from bot_apps where bot_user_id = p_target\) then raise exception 'target_is_bot'; end if;/g, ''],
}
const SRC = { 86: sql('86_join_messages.sql'), 81: sql('81_forums.sql'), 82: sql('82_server_rules.sql'), 83: sql('83_verification_level.sql'), 84: sql('84_public_servers.sql'), 85: sql('85_perm_fixes.sql'), 87: sql('87_perm_fixes2.sql'), 88: sql('88_gifs_private.sql'), 89: sql('89_catalogs.sql'), 90: sql('90_catalog_banner.sql'), 91: sql('91_bot_profile.sql'), 92: sql('92_simple_bot.sql'), 93: sql('93_profile_banner.sql'), 95: sql('95_bot_membership.sql'), 96: sql('96_bots_not_kickable.sql') }
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
await db.exec(sql('54_security_hardening.sql').split('-- ====== B)')[0])
await db.exec(SRC[85])
await db.exec(SRC[86])
await db.exec(SRC[87])
await db.exec(SRC[88])
await db.exec(SRC[89])
await db.exec(SRC[90])
await db.exec(SRC[91])
await db.exec(SRC[92])
await db.exec(SRC[93])
await db.exec(SRC[95])
// Журнал сервера заводится в 68 — её песочница целиком не применяет, а функции
// из 96 в него пишут. Без таблицы «бота нельзя кикнуть» проходило бы по ложной
// причине: исключение про бота бросается раньше, чем дело дойдёт до записи.
await db.exec(`create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  actor_id uuid not null, actor_name text not null, action text not null,
  target_name text, detail text, created_at timestamptz not null default now());`)
await db.exec(SRC[96])
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

// ── Сообщение о вступлении (86) ───────────────────────────────────────────
// v1.329.0: строчку «X присоединился» пишет сама база при вступлении, а не
// клиент — иначе её не было бы при входе с другого устройства.
const joinSrv = (await db.query(`insert into servers (name, owner, settings) values ($1,$2,'{"public":true}'::jsonb) returning id`, ['Публичный2', OWNER])).rows[0].id
const gen = (await db.query(`insert into channels (server_id, name) values ($1,'общий') returning id`, [joinSrv])).rows[0].id
await db.query(`insert into channels (server_id, name, settings) values ($1,'закрытый','{"private":true}'::jsonb)`, [joinSrv])
await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [joinSrv, OWNER, 'o'])

await check('вступление добавляет системную строчку в канал', async () => {
  await as(OTHER, `select join_public_server($1,'Новичок')`, [joinSrv])
  const r = await db.query(`select author_name, content from messages where channel_id=$1`, [gen])
  return r.rows.length === 1 && r.rows[0].author_name === 'Новичок' && r.rows[0].content.includes('sys:join')
})
await check('повторный вход не плодит строчки', async () => {
  await as(OTHER, `select join_public_server($1,'Новичок')`, [joinSrv])
  return (await db.query('select 1 from messages where channel_id=$1', [gen])).rows.length === 1
})
await check('приватный канал под системные сообщения не берётся', async () => {
  const r = await db.query(`select count(*)::int n from messages m join channels c on c.id=m.channel_id
                             where c.server_id=$1 and (c.settings->>'private')::boolean is true`, [joinSrv])
  return r.rows[0].n === 0
})
await db.query(`update servers set settings = settings || '{"sys_welcome":false}'::jsonb where id=$1`, [joinSrv])
await check('выключённая настройка отключает строчку', async () => {
  await as(MOD, `select join_public_server($1,'Тихий')`, [joinSrv])
  return (await db.query('select 1 from messages where channel_id=$1', [gen])).rows.length === 1
})

// ── Захват сервера, права ролей, события и эмодзи (87) ────────────────────
// v1.330.0: продолжение сверки «что показывает интерфейс» против «что запрещает
// база». Отдельный сервер, чтобы роли из проверок выше сюда не примешивались.
const PLAIN = '66666666-6666-6666-6666-666666666666'
await db.query('insert into auth.users values ($1)', [PLAIN])
const s87 = (await db.query('insert into servers (name, owner) values ($1,$2) returning id', ['S87', OWNER])).rows[0].id
for (const u of [MOD, USER, OTHER, PLAIN])
  await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [s87, u, 'n'])
const mkRole = async (name, perms) =>
  (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,$3) returning id', [s87, name, perms])).rows[0].id
const rAdmin = await mkRole('админ', 1)        // MANAGE_SERVER
const rRoles = await mkRole('ролевод', 2 | 32) // MANAGE_ROLES + MANAGE_MESSAGES
const rChan  = await mkRole('каналы', 4)       // MANAGE_CHANNELS
const rEvent = await mkRole('события', 256)    // MANAGE_EVENTS
await db.query('insert into member_roles values ($1,$2,$3)', [s87, MOD, rAdmin])
await db.query('insert into member_roles values ($1,$2,$3)', [s87, USER, rRoles])
await db.query('insert into member_roles values ($1,$2,$3)', [s87, OTHER, rChan])
await db.query('insert into member_roles values ($1,$2,$3)', [s87, PLAIN, rEvent])

await refused('«Управление сервером» не делает владельцем', () =>
  as(MOD, 'update servers set owner=$1 where id=$2', [MOD, s87]))
await check('владелец сервером остался прежним', async () =>
  (await db.query('select owner from servers where id=$1', [s87])).rows[0].owner === OWNER)
// Передать сервер другому человеку нельзя и владельцу: servers_update написана
// без with check, а значит проверяется тем же условием, что и using, — строка
// после правки должна принадлежать тому, кто правит. Возможности «передать
// сервер» в приложении нет вообще, так что это ограничение, а не поломка; но
// если она появится, менять придётся и политику.
await refused('передать сервер нельзя и владельцу (такой возможности нет)', () =>
  as(OWNER, 'update servers set owner=$1 where id=$2', [MOD, s87]))

const mkChan = (uid, name) => as(uid, 'insert into channels (server_id, name) values ($1,$2)', [s87, name])
await refused('канал заводит не любой участник', () => mkChan(PLAIN, 'самодельный'))
await check('с «управлением каналами» канал заводится', async () => {
  await mkChan(OTHER, 'законный'); return true
})
await check('владельцу канал заводить не мешаем', async () => {
  await mkChan(OWNER, 'от владельца'); return true
})

await check('с «управлением ролями» роль создаётся', async () => {
  await as(USER, `insert into server_roles (server_id, name, permissions) values ($1,'помощник',32)`, [s87])
  return (await db.query(`select 1 from server_roles where server_id=$1 and name='помощник'`, [s87])).rows.length === 1
})
await refused('нельзя выдать право, которого у тебя нет', () =>
  as(USER, `insert into server_roles (server_id, name, permissions) values ($1,'себе побольше',1)`, [s87]))
await check('чужую роль сильнее своей не переписать', async () => {
  await as(USER, `update server_roles set permissions=3 where id=$1`, [rAdmin])
  return Number((await db.query('select permissions from server_roles where id=$1', [rAdmin])).rows[0].permissions) === 1
})
await check('и не удалить', async () => {
  await as(USER, `delete from server_roles where id=$1`, [rAdmin])
  return (await db.query('select 1 from server_roles where id=$1', [rAdmin])).rows.length === 1
})

// Роль с ЧУЖОГО сервера: своя роль на своём сервере может иметь любые биты —
// вопрос в том, засчитываются ли они на сервере, где их никто не выдавал.
const mine = (await db.query('insert into servers (name, owner) values ($1,$2) returning id', ['Мой', USER])).rows[0].id
const rAll = (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,$3) returning id', [mine, 'всё', 131071])).rows[0].id
await refused('роль с чужого сервера себе не выдать', () =>
  as(USER, 'insert into member_roles values ($1,$2,$3)', [s87, USER, rAll]))
// Отдельно от проверки «раздать можно только своё»: тут права роли безобидные и
// у выдающего они есть — отвергнуть должно именно потому, что роль не отсюда.
const rMild = (await db.query('insert into server_roles (server_id, name, permissions) values ($1,$2,32) returning id', [mine, 'тихая'])).rows[0].id
await refused('и безобидную роль с чужого сервера тоже не выдать', () =>
  as(USER, 'insert into member_roles values ($1,$2,$3)', [s87, OTHER, rMild]))
await check('и даже вписанная напрямую — прав не даёт', async () => {
  await db.query('insert into member_roles values ($1,$2,$3)', [s87, USER, rAll])
  const r = await db.query('select (server_permissions($1,$2) & 1) <> 0 as adm', [s87, USER])
  await db.query('delete from member_roles where server_id=$1 and role_id=$2', [s87, rAll])
  return r.rows[0].adm === false
})

const mkEvent = (uid, title) =>
  as(uid, 'insert into server_events (server_id, title, created_by) values ($1,$2,$3)', [s87, title, uid])
await check('право «управление событиями» событие создаёт', async () => {
  await mkEvent(PLAIN, 'сходка'); return true
})
await refused('без прав событие не создать', () => mkEvent(USER, 'самозванец'))

await db.query(`insert into custom_emoji (name, url, owner) values ('pepe','своя.png',$1)`, [USER])
const emojiUrl = async () => (await db.query(`select url from custom_emoji where name='pepe'`)).rows[0]?.url
await check('чужое кастом-эмодзи не подменить', async () => {
  await as(OTHER, `update custom_emoji set url='чужая.png' where name='pepe'`)
  return await emojiUrl() === 'своя.png'
})
await check('чужое кастом-эмодзи не удалить', async () => {
  await as(OTHER, `delete from custom_emoji where name='pepe'`)
  return await emojiUrl() === 'своя.png'
})
await check('своё кастом-эмодзи меняется', async () => {
  await as(USER, `update custom_emoji set url='новая.png' where name='pepe'`)
  return await emojiUrl() === 'новая.png'
})

await refused('в общий кэш обложек не подсунуть javascript:', () =>
  as(USER, `insert into game_covers (name, cover_url) values ('Игра','javascript:alert(1)')`))
await check('обычная обложка кладётся по-прежнему', async () => {
  await as(USER, `insert into game_covers (name, cover_url) values ('Игра2','https://example.com/a.png')`)
  return (await db.query(`select 1 from game_covers where name='Игра2'`)).rows.length === 1
})

// «Мои GIF» — личная коллекция, а не общая на всё приложение (88).
await db.query(`insert into gifs (url, owner) values ('чужая.gif',$1)`, [OTHER])
await db.query(`insert into gifs (url, owner) values ('своя.gif',$1)`, [USER])
await check('чужие GIF не видно', async () =>
  (await as(USER, 'select url from gifs')).rows.every(r => r.url === 'своя.gif'))
await check('свои GIF видно', async () =>
  (await as(USER, 'select url from gifs')).rows.length === 1)
await check('чужую GIF не удалить', async () => {
  await as(USER, `delete from gifs where url='чужая.gif'`)
  return (await db.query(`select 1 from gifs where url='чужая.gif'`)).rows.length === 1
})
await check('свою GIF удалить можно', async () => {
  await as(USER, `delete from gifs where url='своя.gif'`)
  return (await db.query(`select 1 from gifs where url='своя.gif'`)).rows.length === 0
})

// ── Каталоги плагинов и ботов (89) ───────────────────────────────────────
await db.query(`insert into profiles (id, username, display_name) values ($1,'user','Пользователь')`, [USER])
await db.query(`insert into profiles (id, username, display_name) values ($1,'other','Посторонний')`, [OTHER])
const pluginRow = (id, uid) => as(uid,
  `insert into plugin_catalog (id, name, version, author_id, author_name, summary, code)
   values ($1,'Плагин','1.0.0',$2,'кто-то','коротко','function onLoad(){}')`, [id, uid])

await check('плагин выкладывается в каталог', async () => {
  await pluginRow('my-plugin', USER)
  return (await db.query(`select 1 from plugin_catalog where id='my-plugin'`)).rows.length === 1
})
await check('имя автора ставит база, а не клиент', async () =>
  (await db.query(`select author_name from plugin_catalog where id='my-plugin'`)).rows[0].author_name === 'Пользователь')
await check('автор — тот, кто выкладывает', async () =>
  (await db.query(`select author_id from plugin_catalog where id='my-plugin'`)).rows[0].author_id === USER)
// Подделать автора нельзя не отказом, а тем, что база всё равно ставит своё:
// прислать чужой author_id можно, но в строке окажется тот, кто её выложил.
await check('автора не подделать — база ставит своего', async () => {
  await as(OTHER, `insert into plugin_catalog (id, name, version, author_id, author_name, summary, code)
                   values ('fake','Подделка','1.0.0',$1,'Пользователь','коротко','x')`, [USER])
  const r = (await db.query(`select author_id, author_name from plugin_catalog where id='fake'`)).rows[0]
  return r.author_id === OTHER && r.author_name === 'Посторонний'
})
await check('чужой плагин не переписать', async () => {
  await as(OTHER, `update plugin_catalog set code='зло' where id='my-plugin'`)
  return (await db.query(`select code from plugin_catalog where id='my-plugin'`)).rows[0].code === 'function onLoad(){}'
})
await check('чужой плагин не снять с каталога', async () => {
  await as(OTHER, `delete from plugin_catalog where id='my-plugin'`)
  return (await db.query(`select 1 from plugin_catalog where id='my-plugin'`)).rows.length === 1
})
await refused('занятый id не перехватить', () => pluginRow('my-plugin', OTHER))
await check('счётчик установок двигает посторонний', async () => {
  await as(OTHER, `select plugin_installed('my-plugin')`)
  return (await db.query(`select installs from plugin_catalog where id='my-plugin'`)).rows[0].installs === 1
})
await check('чужая установка не делает установившего автором', async () =>
  (await db.query(`select author_id from plugin_catalog where id='my-plugin'`)).rows[0].author_id === USER)
await check('свой плагин автор снимает сам', async () => {
  await as(USER, `delete from plugin_catalog where id='my-plugin'`)
  return (await db.query(`select 1 from plugin_catalog where id='my-plugin'`)).rows.length === 0
})

const botApp = (await db.query(
  `insert into bot_apps (owner_id, bot_user_id, name) values ($1,$2,'Мой бот') returning id`, [USER, MOD])).rows[0].id
await check('фон карточки сохраняется у плагина', async () => {
  await as(USER, `insert into plugin_catalog (id, name, version, author_id, author_name, summary, code, icon_url, banner_url)
                  values ('with-art','С картинками','1.0.0',$1,'x','коротко','c','https://e/i.png','https://e/b.jpg')`, [USER])
  const r = (await db.query(`select icon_url, banner_url from plugin_catalog where id='with-art'`)).rows[0]
  return r.icon_url === 'https://e/i.png' && r.banner_url === 'https://e/b.jpg'
})
await check('фон можно поменять при обновлении', async () => {
  await as(USER, `update plugin_catalog set banner_url='https://e/new.jpg' where id='with-art'`)
  return (await db.query(`select banner_url from plugin_catalog where id='with-art'`)).rows[0].banner_url === 'https://e/new.jpg'
})
await check('чужой фон не поменять', async () => {
  await as(OTHER, `update plugin_catalog set banner_url='https://зло' where id='with-art'`)
  return (await db.query(`select banner_url from plugin_catalog where id='with-art'`)).rows[0].banner_url === 'https://e/new.jpg'
})

await check('своего бота автор выкладывает', async () => {
  await as(USER, `insert into bot_catalog (app_id, name, author_id, author_name, summary) values ($1,'Мой бот',$2,'x','коротко')`, [botApp, USER])
  return (await db.query('select 1 from bot_catalog where app_id=$1', [botApp])).rows.length === 1
})
await refused('чужого бота в каталог не выложить', () => as(OTHER,
  `insert into bot_catalog (app_id, name, author_id, author_name, summary) values ($1,'Чужой',$2,'x','коротко')`, [botApp, OTHER]))
await check('вид встроенного бота не приписать себе', async () => {
  await as(USER, `update bot_apps set builtin='dice' where id=$1`, [botApp]).catch(() => {})
  return (await db.query('select builtin from bot_apps where id=$1', [botApp])).rows[0].builtin === null
})
await check('счётчик добавлений двигает посторонний', async () => {
  await as(OTHER, `select bot_added($1)`, [botApp])
  return (await db.query('select adds from bot_catalog where app_id=$1', [botApp])).rows[0].adds === 1
})

// ── Профиль бота и счётчики каталога (91) ────────────────────────────────
await db.query(`insert into profiles (id, username, display_name, is_bot) values ($1,'bot','Бот',true)`, [MOD])
await check('владелец настраивает своего бота', async () => {
  await as(USER, `select set_bot_profile($1,'https://e/a.png','я бот','#112233','#445566')`, [botApp])
  const r = (await db.query('select avatar_url, about, primary_color from profiles where id=$1', [MOD])).rows[0]
  return r.avatar_url === 'https://e/a.png' && r.about === 'я бот' && r.primary_color === '#112233'
})
await refused('чужого бота не настроить', () =>
  as(OTHER, `select set_bot_profile($1,'https://зло/a.png','взлом',null,null)`, [botApp]))
await refused('аватарка бота только по https', () =>
  as(USER, `select set_bot_profile($1,'javascript:alert(1)','x',null,null)`, [botApp]))
await refused('цвет бота только шестнадцатеричный', () =>
  as(USER, `select set_bot_profile($1,null,'x','red',null)`, [botApp]))
await check('шапка профиля бота сохраняется', async () => {
  await as(USER, `select set_bot_profile($1,'https://e/a.png','я бот','#112233','#445566','https://e/b.jpg')`, [botApp])
  return (await db.query('select banner_url from profiles where id=$1', [MOD])).rows[0].banner_url === 'https://e/b.jpg'
})
await refused('шапка только по https', () =>
  as(USER, `select set_bot_profile($1,null,'x',null,null,'javascript:alert(1)')`, [botApp]))
await check('аватарка продублирована в каталог', async () =>
  (await db.query('select avatar_url from bot_apps where id=$1', [botApp])).rows[0].avatar_url === 'https://e/a.png')

await check('счётчик считает и встроенное, у чего строки в каталоге нет', async () => {
  await as(OTHER, `select catalog_installed('bot','builtin:dice')`)
  await as(USER, `select catalog_installed('bot','builtin:dice')`)
  const r = (await db.query(`select installs from catalog_stats where kind='bot' and ref='builtin:dice'`)).rows[0]
  return r?.installs === 2
})
await check('счётчик плагина считается и в общей таблице', async () => {
  await as(OTHER, `select catalog_installed('plugin','ponoi-dice')`)
  return (await db.query(`select installs from catalog_stats where kind='plugin' and ref='ponoi-dice'`)).rows[0]?.installs === 1
})
await refused('вид счётчика на выбор не подсунуть', () =>
  as(OTHER, `select catalog_installed('что-нибудь','x')`))
await check('счётчик напрямую не переписать', async () => {
  await as(OTHER, `update catalog_stats set installs = 9999 where kind='bot'`)
  return (await db.query(`select installs from catalog_stats where kind='bot' and ref='builtin:dice'`)).rows[0].installs === 2
})

// ── Бот без программирования (92) ────────────────────────────────────────
await check('ответ команды сохраняется', async () => {
  await db.query(`insert into bot_commands (bot_app_id, name, description, reply) values ($1,'правила','x','Не ругаться')`, [botApp])
  return (await db.query(`select reply from bot_commands where bot_app_id=$1 and name='правила'`, [botApp])).rows[0].reply === 'Не ругаться'
})
await refused('слишком длинный ответ база не примет', () =>
  db.query(`insert into bot_commands (bot_app_id, name, description, reply) values ($1,'длинная','x',$2)`, [botApp, 'я'.repeat(2001)]))

await check('избранные эмодзи попали в публикацию realtime', async () =>
  (await db.query(`select 1 from pg_publication_tables
                    where pubname='supabase_realtime' and schemaname='public' and tablename='emoji_favs'`)).rows.length === 1)


// ── Боты на сервере (v1.355.0) ───────────────────────────────────────────
// Бота нельзя поставить дважды и убрать его вправе не любой участник.
{
  const BOT = 'b0b00000-0000-4000-8000-00000000b071'
  await db.query('insert into auth.users values ($1)', [BOT])
  const app = (await db.query(
    `insert into bot_apps (owner_id, bot_user_id, name, token_hash) values ($1,$2,'Кубик','h') returning id`,
    [OWNER, BOT])).rows[0].id
  await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, BOT, 'Кубик'])

  await check('одного бота нельзя добавить на сервер дважды', async () => {
    // Ключ (server_id, user_id) — та самая защита, на которую опирается функция
    // bot-add-to-server, отвечая «этот бот уже есть на сервере».
    try {
      await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, BOT, 'Кубик'])
      return false
    } catch { return true }
  })

  await check('участник без права не уберёт бота напрямую', async () => {
    // Прямое удаление строки бота — то, что делала кнопка до v1.355.0.
    await as(USER, 'delete from server_members where server_id=$1 and user_id=$2', [srv, BOT])
    return (await db.query('select 1 from server_members where server_id=$1 and user_id=$2', [srv, BOT])).rows.length === 1
  })

  await check('участник без права не уберёт бота и через функцию', async () => {
    try {
      await as(USER, 'select remove_bot_from_server($1,$2)', [BOT, srv])
      return false
    } catch (e) { return String(e.message).includes('missing_manage_bots') }
  })

  await check('«Управление ботами» не даёт выгонять живых людей', async () => {
    // Иначе право на ботов тихо превратилось бы в право кикать участников.
    try {
      await as(OWNER, 'select remove_bot_from_server($1,$2)', [USER, srv])
      return false
    } catch (e) { return String(e.message).includes('not_a_bot') }
  })

  await check('роль с «Управлением ботами» бота убирает', async () => {
    const r = (await db.query(
      'insert into server_roles (server_id, name, permissions) values ($1,$2,$3) returning id', [srv, 'botmaster', 512])).rows[0].id
    await db.query('insert into member_roles values ($1,$2,$3)', [srv, USER, r])
    await as(USER, 'select remove_bot_from_server($1,$2)', [BOT, srv])
    const gone = (await db.query('select 1 from server_members where server_id=$1 and user_id=$2', [srv, BOT])).rows.length === 0
    // Возвращаем на место — дальше по файлу сервер ещё используется.
    await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, BOT, 'Кубик'])
    await db.query('delete from member_roles where server_id=$1 and user_id=$2 and role_id=$3', [srv, USER, r])
    return gone
  })

  await check('владелец сервера бота убирает', async () => {
    await as(OWNER, 'select remove_bot_from_server($1,$2)', [BOT, srv])
    const gone = (await db.query('select 1 from server_members where server_id=$1 and user_id=$2', [srv, BOT])).rows.length === 0
    await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, BOT, 'Кубик'])
    return gone
  })

  await check('бота нельзя кикнуть', async () => {
    try {
      await as(OWNER, 'select kick_member($1,$2)', [srv, BOT])
      return false
    } catch (e) { return String(e.message).includes('target_is_bot') }
  })

  await check('бота нельзя забанить', async () => {
    // Бан был хуже кика: строка в server_bans мешала владельцу вернуть своего же
    // бота обратно, и причина нигде не показывалась.
    try {
      await as(OWNER, 'select ban_member($1,$2,null)', [srv, BOT])
      return false
    } catch (e) { return String(e.message).includes('target_is_bot') }
  })

  await check('бота нельзя отправить в тайм-аут', async () => {
    try {
      await as(OWNER, `select timeout_member($1,$2, now() + interval '1 hour')`, [srv, BOT])
      return false
    } catch (e) { return String(e.message).includes('target_is_bot') }
  })

  await check('живого участника кикать по-прежнему можно', async () => {
    // Иначе защита ботов тихо сломала бы модерацию целиком.
    await as(OWNER, 'select kick_member($1,$2)', [srv, OTHER])
    const gone = (await db.query('select 1 from server_members where server_id=$1 and user_id=$2', [srv, OTHER])).rows.length === 0
    await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, OTHER, 'n'])
    return gone
  })

  await check('кик по-прежнему пишется в журнал сервера', async () => {
    // Тела функций в 96 переписаны целиком — легко было потерять запись в журнал.
    const before = (await db.query(`select count(*)::int c from audit_log where action='kick'`)).rows[0].c
    await as(OWNER, 'select kick_member($1,$2)', [srv, OTHER])
    const after = (await db.query(`select count(*)::int c from audit_log where action='kick'`)).rows[0].c
    await db.query('insert into server_members (server_id, user_id, member_name) values ($1,$2,$3)', [srv, OTHER, 'n'])
    return after === before + 1
  })

  void app
}

console.log(`\nИТОГ: пройдено ${pass}, провалено ${fail}`)
process.exit(fail ? 1 : 0)
