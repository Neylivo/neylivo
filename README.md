<div align="center">

# Ponoi

**Private. Extensible. Yours.**

Ponoi is a privacy-focused extensible messenger for conversations, communities,
calls, music and user-created plugins. Windows, Android and the web.

*Ponoi (Поной) — приватный расширяемый мессенджер для общения, сообществ,
звонков, музыки и пользовательских плагинов.*

[**Website**](https://ponoiai.github.io/) ·
[**Download**](https://ponoiai.github.io/download/) ·
[**Open web app**](https://ponoiai.github.io/ponoi/) ·
[**Documentation**](https://ponoiai.github.io/docs/) ·
[**Security**](https://ponoiai.github.io/security/) ·
[**Plugins**](https://ponoiai.github.io/plugins/)

</div>

---

## What it is

A messenger you can rebuild. Direct messages and group conversations, servers
with text, voice and forum channels, calls with video and screen sharing,
a built-in music system, and plugins that anyone can write and hand to a friend
as a single `.ponoi` file.

- **Messaging** — direct and group conversations, replies, reactions, editing,
  pins, threads, attachments, GIFs, custom emoji, slash commands.
- **Communities** — servers, channels, roles with granular permissions,
  invites, moderation with an audit log, webhooks and bots.
- **Calls** — voice, video, screen sharing with sound, noise suppression,
  push-to-talk, an overlay that stays on top of games.
- **Trackoteka** — a shared music library with playlists, a queue, synced
  lyrics and listening together in one room.
- **Customization** — light and dark themes, presets, custom fonts, chat
  backgrounds, profile colours and banners.
- **Plugins** — one `.ponoi` JavaScript file, isolated in a Web Worker, with
  permissions the user sees before installing.

**Free.** No paid tiers, no subscriptions, no advertising, no analytics.

## Status of each part

| | |
|---|---|
| Messaging, communities, customization | **Available** |
| Calls: voice, video, screen sharing | **Available** |
| Trackoteka and the plugin platform | **Available** |
| End-to-end encryption for direct messages, attachments and calls | **Available, optional, off by default** |
| End-to-end encrypted calls, verified in a real call between two devices | **Experimental** — tested in code, never confirmed in the field |
| Private attachment storage | **Planned** — see below |
| End-to-end encryption for groups and channels | **Planned** — design first, see [`E2EE_DESIGN.md`](E2EE_DESIGN.md) |

## Security, honestly

One-to-one direct messages can be end-to-end encrypted with ECDH P-256,
HKDF-SHA256 and AES-256-GCM; keys belong to devices, message length is hidden by
padding, and there is no silent fallback to plaintext. Plugins are isolated by
the browser itself — a Web Worker, and an opaque-origin sandboxed frame for
plugin pages. There is no analytics, no crash reporting and no advertising code
in the app.

And the parts that are not good yet, in the project’s own words:

- Encryption is **off by default**, and covers one-to-one conversations only —
  not group chats, not server channels.
- **Attachments sent without attachment encryption are in public storage** and
  can be downloaded by anyone with the link. This is the most serious open issue
  and it is being fixed in stages.
- Call encryption has never been verified in a real call.
- There is no Content-Security-Policy, and no external security audit.

The full technical write-up, with file references, is in
[`SECURITY_ARCHITECTURE_AUDIT.md`](SECURITY_ARCHITECTURE_AUDIT.md). The
user-facing version is at [ponoiai.github.io/security](https://ponoiai.github.io/security/),
and the list of known weaknesses is at
[ponoiai.github.io/transparency](https://ponoiai.github.io/transparency/).

To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Get Ponoi

Downloads live on the website, not here:
**[ponoiai.github.io/download](https://ponoiai.github.io/download/)** — the
Windows installer, the Android APK and the web version, all linked directly.

---

# Developer documentation

Everything below is for building Ponoi, not for using it.

## Stack

Vite + React + TypeScript. Supabase for the database, accounts, storage and
realtime; LiveKit for voice and video. Electron for the Windows build, Capacitor
for Android. No backend of our own to run.

## Running it

1. Node.js 20+ (Capacitor CLI needs 22+; the Android build in CI uses 22).
2. `npm install`
3. Create a project at <https://supabase.com>.
4. **Storage → create the buckets** `avatars`, `attachments`, `modfiles`.
5. **SQL Editor → run the migrations strictly in numeric order**: first
   `supabase/schema.sql`, then every `supabase/NN_*.sql` by its numeric prefix
   (`02`, `03`, … `110`). Plain name sorting puts `100_` before `10_`, which is
   the wrong order. `04_storage.sql` goes after the buckets exist.
   Skipping recent migrations breaks features at runtime: channel permissions,
   bots, privacy, music, read receipts, plugin transfers and more.
6. Project Settings → API → copy the **Project URL** and the **anon public key**.
7. Copy `.env.example` to `.env`:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_VAPID_PUBLIC_KEY=...       # optional, push notifications
   VITE_TENOR_KEY=...              # optional, GIF search
   VITE_STEAMGRIDDB_KEY=...        # optional, game cover art
   ```
8. Optional Edge Functions — see `supabase/functions/README.md`:
   - `livekit-token` — without it, text works and the call button errors.
   - `login-by-username` — without it, only email login works.
   - `send-push` — without it, no notifications while the app is closed.
9. `npm run dev`

## Checks

The project leans on live checks rather than assertions about code that was
never run. A few of the load-bearing ones:

```bash
npm run typecheck     # TypeScript
npm run test:db       # RLS rules against a real Postgres (pglite), 1500+ lines
npm run test:crypto   # the encryption core, in a real browser engine
npm run test:plugins  # the plugin system
npm run test:attack   # deliberate attempts to escape the plugin sandbox
npm run test:capture  # screen capture protection, by actually capturing the screen
npm run smoke         # the built app starts
```

`npm run look` and `npm run look:real` take screenshots of the interface, the
second one with the real components rather than markup written by hand.

## Releasing

```bash
git tag v1.0.0
git push --tags
```

GitHub Actions builds `Ponoi-Setup-<version>.exe` and
`Ponoi-Setup-<version>.apk` and attaches both to one release. The Android job
**fails on purpose** if the signing keystore secret is missing, rather than
signing with a throwaway debug key that would produce an APK nobody can install
over their existing one.

Required repository secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`. Optional: `VITE_VAPID_PUBLIC_KEY`, `VITE_TENOR_KEY`,
`VITE_STEAMGRIDDB_KEY`.

Commit messages become the changelog (`scripts/gen-changelog.mjs`), which the
app shows in its “What’s new” window and the website publishes at
[/changelog/](https://ponoiai.github.io/changelog/).

## The website

The site at <https://ponoiai.github.io/> is a separate repository:
[ponoiai/ponoiai.github.io](https://github.com/ponoiai/ponoiai.github.io). The
web version of the app stays where it has always been,
<https://ponoiai.github.io/ponoi/>, so invite links and installed PWAs keep
working.

## Writing plugins

See [`PLUGINS.md`](PLUGINS.md) for the file format, the API and how isolation
works — or use the editor inside the app: Settings → Plugins → Create.

## Licence

Not chosen yet. The source is public and readable, but without a licence it is
formally source-available rather than open source.
