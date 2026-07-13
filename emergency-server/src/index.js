// Ponoi — аварийный резервный чат.
// Не копия основного бэкенда (Supabase) — отдельная, маленькая, только на случай,
// если основной ляжет надолго, пока некому его перезапустить. Один общий чат,
// свои аккаунты (НЕ те же, что в основном Ponoi), без серверов/каналов/друзей.
// Используется только когда клиент видит, что Supabase недоступен несколько минут.
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { WebSocketServer } = require('ws')
const http = require('http')

const PORT = process.env.PORT || 10000
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-dev-only'
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) { console.error('DATABASE_URL не задан — нужна Render Postgres'); process.exit(1) }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function initDb() {
  await pool.query(`
    create table if not exists ec_users (
      id serial primary key,
      username text unique not null,
      password_hash text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists ec_messages (
      id serial primary key,
      user_id int not null references ec_users(id) on delete cascade,
      username text not null,
      content text not null,
      created_at timestamptz not null default now()
    );
  `)
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true, service: 'ponoi-emergency-chat' }))

function signToken(user) { return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' }) }

function auth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Нет токена' })
  try { req.user = jwt.verify(token, JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Токен недействителен' }) }
}

app.post('/register', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (username.length < 2 || username.length > 32) return res.status(400).json({ error: 'Имя пользователя: 2-32 символа' })
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' })
    const exists = await pool.query('select id from ec_users where lower(username) = lower($1)', [username])
    if (exists.rows.length) return res.status(400).json({ error: 'Это имя уже занято' })
    const hash = await bcrypt.hash(password, 10)
    const r = await pool.query('insert into ec_users (username, password_hash) values ($1, $2) returning id, username', [username, hash])
    const user = r.rows[0]
    res.json({ token: signToken(user), username: user.username })
  } catch (e) { console.error('register failed:', e); res.status(500).json({ error: 'Ошибка сервера' }) }
})

app.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const r = await pool.query('select id, username, password_hash from ec_users where lower(username) = lower($1)', [username])
    const user = r.rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(400).json({ error: 'Неверное имя или пароль' })
    res.json({ token: signToken(user), username: user.username })
  } catch (e) { console.error('login failed:', e); res.status(500).json({ error: 'Ошибка сервера' }) }
})

app.get('/messages', auth, async (_req, res) => {
  try {
    const r = await pool.query('select id, username, content, created_at from ec_messages order by created_at desc limit 100')
    res.json({ messages: r.rows.reverse() })
  } catch (e) { console.error('load messages failed:', e); res.status(500).json({ error: 'Ошибка сервера' }) }
})

app.post('/messages', auth, async (req, res) => {
  try {
    const content = String(req.body?.content || '').trim().slice(0, 2000)
    if (!content) return res.status(400).json({ error: 'Пустое сообщение' })
    const r = await pool.query(
      'insert into ec_messages (user_id, username, content) values ($1, $2, $3) returning id, username, content, created_at',
      [req.user.id, req.user.username, content],
    )
    const msg = r.rows[0]
    broadcast({ type: 'message', msg })
    res.json({ msg })
  } catch (e) { console.error('send message failed:', e); res.status(500).json({ error: 'Ошибка сервера' }) }
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

function broadcast(payload) {
  const data = JSON.stringify(payload)
  for (const ws of clients) { try { if (ws.readyState === 1) ws.send(data) } catch {} }
}

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, 'http://x')
    const token = url.searchParams.get('token')
    jwt.verify(token, JWT_SECRET)
  } catch { ws.close(4001, 'unauthorized'); return }
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

initDb()
  .then(() => server.listen(PORT, () => console.log('emergency-server listening on ' + PORT)))
  .catch(e => { console.error('DB init failed:', e); process.exit(1) })
