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

# For developers

Ponoi is written in TypeScript on React, with Supabase for the database,
accounts, storage and realtime, LiveKit for voice and video, Electron for the
Windows build and Capacitor for Android. There is no backend of our own.

**How to fetch and build the source is deliberately not documented here.** This
page is for people who use Ponoi, and a setup recipe at the top of it only gets
in their way. What a developer actually needs is documented where it belongs:

- [`PLUGINS.md`](PLUGINS.md) — the `.ponoi` file format, the plugin API and how
  isolation works. Plugins are the supported way to extend Ponoi, and they need
  no build environment at all: the editor is inside the app, under
  Settings → Plugins → Create.
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability.
- [`SECURITY_ARCHITECTURE_AUDIT.md`](SECURITY_ARCHITECTURE_AUDIT.md) — what
  actually protects data, with file references.
- [`E2EE_DESIGN.md`](E2EE_DESIGN.md) — the design for group encryption, before
  any of it is written.
- [ponoiai.github.io/changelog](https://ponoiai.github.io/changelog/) — every
  release, with what changed in each.

The website at <https://ponoiai.github.io/> is a separate repository,
[ponoiai/ponoiai.github.io](https://github.com/ponoiai/ponoiai.github.io). The
web version of the app stays at <https://ponoiai.github.io/ponoi/>, so invite
links and installed PWAs keep working.

## Licence

Not chosen yet. The source is public and readable, but without a licence it is
formally source-available rather than open source.
