# Privacy — the short version

The full, authoritative page is **<https://neylivo.github.io/privacy/>**
(по-русски: <https://neylivo.github.io/ru/privacy/>). This file is a summary for
people reading the repository.

## What NeyLivo collects

- **An email address and a password** to register. Nothing else is required.
  The password is stored by Supabase Auth as a bcrypt hash; there is no password
  storage code in this project.
- **Your username, and whatever you put in your profile** — avatar, banner,
  colours, pronouns, about text.
- **Your messages and files**, so they can be delivered and shown on your
  devices.
- **Trusted device records** — a random identifier the app generates, a label
  you can set, and when the device was last seen. It says nothing about your
  hardware.
- **A push subscription**, only if you allow notifications.

## What NeyLivo does not collect

- **No analytics.** There is no analytics SDK in the app — not a third-party
  one, not a self-hosted one.
- **No crash reporting service.** Errors are written to local storage on your
  device and are not uploaded.
- **No advertising code.** None.
- **No location.** The app never asks for it.
- **No IP address table.** NeyLivo stores no IP addresses of its own. The
  infrastructure it runs on sees connections, as any online service does.

## Encryption, plainly

One-to-one direct messages can be end-to-end encrypted, together with their
attachments and their calls. These are **three separate settings and all are off
by default**. Group conversations and server channels are **not** end-to-end
encrypted.

**Attachments sent without attachment encryption are stored in public cloud
storage and can be downloaded by anyone who has the link.** This is a known open
problem, documented in [`SECURITY_ARCHITECTURE_AUDIT.md`](SECURITY_ARCHITECTURE_AUDIT.md)
and on [the transparency page](https://neylivo.github.io/transparency/), and it
is being fixed in stages.

## Third parties

NeyLivo runs on **Supabase** (database, accounts, storage, realtime) and
**LiveKit** (voice and video), and downloads updates from **GitHub**. Several
other services are contacted for specific features — GIF search, lyrics, music
links, cover art — and one, the emoji image CDN, is contacted on every launch
without any action from you. All of them are listed with the reason and the
timing on the privacy page.

Fonts are bundled with the app on purpose, so that starting NeyLivo does not
report your IP address to a font CDN before you have even signed in.

## What you control

Turn on end-to-end encryption; choose who may write to you, call you or add you;
block people; delete individual messages; delete your entire account and its
data from inside the app.
