# Security Policy

*По-русски — ниже.*

## Supported versions

NeyLivo ships from a single line of development, and only the latest release is
supported. There are no long-term branches to backport to.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No — update first |

The Windows app updates itself. The Android app checks for updates and offers
them. The web version is always current.

## Reporting a vulnerability

**Please report privately first, and give the problem a chance to be fixed
before it becomes public.** That protects the people using NeyLivo.

1. Use GitHub’s private vulnerability reporting on this repository
   (Security → Report a vulnerability). If that is unavailable to you, open an
   issue asking for a private channel — **without the details**.
2. Do not post a working exploit, other people’s data, or a public write-up
   before a fix exists.

### What to include

- What you did, step by step, and what happened.
- What you expected instead, and why you believe it is a security problem.
- The version, and the platform (Windows / Android / web + browser).
- A short reproduction, if you have one. It is worth more than a long
  description.
- Whether you believe the issue is being exploited already.

Please do not include real user data. If a proof needs an account, use your own.

### What happens next

- Acknowledgement of the report: within a few days.
- An assessment — whether it is reproducible and how serious it is: as soon as
  it has been looked at properly.
- A fix: as fast as the severity warrants. Anything that exposes other people’s
  data comes before everything else on the roadmap.
- Credit in the release notes if you want it, and none if you prefer.

This is an independent project maintained by one person. There is no on-call
rotation and no guaranteed response time — that is a real limitation and it is
better stated than implied.

### Already known

Before reporting, please check
[`SECURITY_ARCHITECTURE_AUDIT.md`](SECURITY_ARCHITECTURE_AUDIT.md) and
[neylivo.github.io/transparency](https://neylivo.github.io/transparency/): the
project publishes its own list of weaknesses, including that attachments sent
without attachment encryption are in public storage, that end-to-end encryption
is off by default and covers one-to-one conversations only, and that there is no
Content-Security-Policy. Those are known; new findings are very welcome.

### No bug bounty

There is no money to pay one. Promising a reward the project cannot honour would
be worse than saying this plainly.

### Scope

In scope: this repository, the released Windows and Android applications, the
web application at <https://neylivo.github.io/neylivo/>, the database rules under
`supabase/`, the Edge Functions, and the plugin sandbox.

Not in scope: the security of Supabase, LiveKit or GitHub themselves — report
those to them; and anything requiring physical access to an unlocked device.

**Please do not** run automated scanners, load tests or brute-force attempts
against the live backend: it is a small shared instance, and taking it down
affects the people using it, not the project’s reputation. Local testing against
your own Supabase project is unrestricted.

---

# Политика безопасности

## Какие версии поддерживаются

Поддерживается только последний выпуск: разработка идёт одной линией, и
переносить исправления некуда.

| Версия | Поддержка |
|---|---|
| Последний выпуск | Да |
| Всё, что старше | Нет — сначала обновиться |

Приложение для Windows обновляется само, Android предлагает обновление,
веб-версия всегда свежая.

## Как сообщить об уязвимости

**Пожалуйста, сообщите сначала лично и дайте шанс починить проблему до того, как
о ней узнают все.** Это защищает людей, которые пользуются NeyLivo.

1. Воспользуйтесь приватным сообщением об уязвимости в этом репозитории
   (Security → Report a vulnerability). Если такой возможности нет, заведите
   обращение с просьбой о личном канале — **без подробностей**.
2. Не публикуйте рабочий эксплойт, чужие данные и разбор до появления
   исправления.

### Что приложить

- Что вы сделали по шагам и что произошло.
- Чего ожидали вместо этого и почему считаете это проблемой безопасности.
- Версию и платформу (Windows / Android / веб и браузер).
- Короткое воспроизведение, если есть. Оно ценнее длинного описания.
- Есть ли основания думать, что этим уже пользуются.

Пожалуйста, не прикладывайте настоящие данные других людей. Если для
доказательства нужна учётная запись — заведите свою.

### Что будет дальше

- Подтверждение получения — в течение нескольких дней.
- Оценка: воспроизводится ли и насколько серьёзно — как только дойдут руки
  разобраться по-настоящему.
- Исправление — тем быстрее, чем серьёзнее. Всё, что раскрывает чужие данные,
  идёт вперёд любых других планов.
- Упоминание в описании выпуска, если вы этого хотите, и молчание, если нет.

Это независимый проект, который ведёт один человек. Дежурной смены нет и
гарантированного срока ответа тоже — это настоящее ограничение, и лучше сказать
о нём прямо, чем подразумевать.

### Что уже известно

Перед отправкой загляните в
[`SECURITY_ARCHITECTURE_AUDIT.md`](SECURITY_ARCHITECTURE_AUDIT.md) и на
[страницу прозрачности](https://neylivo.github.io/ru/transparency/): проект сам
публикует список своих слабых мест, включая то, что вложения без шифрования
лежат в публичном хранилище, что сквозное шифрование выключено по умолчанию и
действует только на переписку один на один и что Content-Security-Policy нет.
Это известно; новые находки очень нужны.

### Вознаграждения нет

Платить нечем. Пообещать награду, которую проект не выплатит, было бы хуже, чем
сказать это прямо.

### Что входит в область

Входит: этот репозиторий, выпущенные приложения для Windows и Android,
веб-приложение <https://neylivo.github.io/neylivo/>, правила доступа к базе в
`supabase/`, Edge Functions и песочница плагинов.

Не входит: безопасность самих Supabase, LiveKit и GitHub — о ней сообщайте им; и
всё, что требует физического доступа к разблокированному устройству.

**Пожалуйста, не запускайте** автоматические сканеры, нагрузочные проверки и
подбор паролей против рабочего сервера: это маленький общий экземпляр, и его
падение задевает живых людей, а не репутацию проекта. Против собственного
проекта Supabase проверяйте что угодно.
