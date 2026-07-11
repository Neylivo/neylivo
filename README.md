# Ponoi (настоящее приложение)

Это исходник Ponoi как **настоящего** приложения: Vite + React + TypeScript + **Supabase**
(регистрация/вход, сервера, каналы и сообщения в реальном времени между устройствами и пользователями),
плюс голос/видео/демонстрация экрана через **LiveKit**.
Он заменяет прежние браузерные live-патчи на реальное приложение с бэкендом.

## Возможности
- Регистрация и вход по email/паролю (Supabase Auth), профили.
- Сервера, каналы и сообщения в реальном времени (Supabase Realtime).
- Друзья и личные сообщения (DM).
- Участники серверов + приглашения по коду (RLS через `server_members`).
- Загрузка аватаров и вложений (Supabase Storage).
- Реакции и закреплённые сообщения.
- Голос/видео/демонстрация экрана (LiveKit).
- Настройки пользователя, темы, Ponoi Music, GIF-пикер, кастом-эмодзи, питомец.

## Установка

1. Установи Node.js 18+.
2. В папке проекта:
   ```bash
   npm install
   ```
3. Создай проект на https://supabase.com (бесплатно).

4. **Storage → создай два ПУБЛИЧНЫХ бакета** (Public bucket: ON):
   - `avatars`
   - `attachments`

5. **SQL Editor → выполни миграции строго по порядку** (каждый файл целиком):
   1. `supabase/schema.sql`
   2. `supabase/02_friends_dm.sql`
   3. `supabase/03_members_invites.sql`
   4. `supabase/04_storage.sql`   (запускать ПОСЛЕ создания бакетов из шага 4)
   5. `supabase/05_reactions_pins.sql`

   Порядок важен: реакции/пины (05) и участники (03) зависят от предыдущих шагов.
   Если пропустить миграции, DM/участники/реакции/пины/загрузки будут падать с ошибкой в рантайме.

6. Project Settings → API → скопируй **Project URL** и **anon public key**.
7. Скопируй `.env.example` в `.env` и подставь значения:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

8. **(Опционально, для звонков)** Разверни Edge Function `livekit-token`
   (`supabase/functions/livekit-token`) и задай секреты LiveKit — см. `supabase/functions/README.md`.
   Без этого текст/сервера/DM работают, а кнопка звонка выдаёт ошибку.

9. Запусти:
   ```bash
   npm run dev
   ```
10. Открой ссылку из терминала, зарегистрируйся, создай сервер (＋) и пиши сообщения.
    Открой второе окно/устройство, войди другим аккаунтом — сообщения приходят в реальном времени.

## Деплой
- `npm run build` → статика в `dist/` (Vercel/Netlify/Cloudflare Pages).
- Supabase и LiveKit — облачные бэкенды, отдельный сервер не нужен.

## Установщик для друзей (Windows) 📦

Сборка настоящего установщика `Ponoi-Setup-<версия>.exe` полностью автоматизирована через GitHub Actions.

**Один раз настроить:**
1. В репозитории: Settings → Secrets and variables → Actions → New repository secret.
   Добавь два секрета (значения — из твоего локального `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

**Выпустить версию:**
```bash
git tag v1.0.0
git push --tags
```
Через ~5 минут на странице **Releases** появится готовый `Ponoi-Setup-1.0.0.exe`.

**Отдать другу:** просто скинь ссылку на .exe со страницы Releases. Друг устанавливает,
регистрируется по email — и вы общаетесь: все данные живут в общем облаке (Supabase),
звонки — через LiveKit. Никаких серверов поднимать не нужно.

Проверить сборку без релиза: вкладка Actions → workflow «release» → Run workflow —
готовый .exe будет в артефактах сборки.

## Приложение для телефона (Android APK) 📱

Тот же тег `vX.Y.Z` одновременно собирает и `Ponoi-Setup-<версия>.exe` (Windows),
и `Ponoi-Setup-<версия>.apk` (Android) — обе сборки уходят в один и тот же
GitHub Release. Play Маркета нет — APK ставится вручную («сайдлоад»), как и
задумано (`.github/workflows/release.yml`, джоба `android-apk`).

**Поставить на телефон:**
1. Releases → скачать `Ponoi-Setup-<версия>.apk` на телефон.
2. При установке Android спросит разрешение «Установка неизвестных приложений» —
   разрешить для браузера/файлового менеджера, которым открываешь файл.
3. Готово: Ponoi на телефоне — то же приложение, тот же Supabase-аккаунт,
   звонки/камера/микрофон запрашиваются как обычно при первом звонке.

**(Опционально) Свой ключ подписи — чтобы новые версии ставились ПОВЕРХ старой,
без удаления приложения.** Без этого шага APK подписывается debug-ключом,
который каждый CI-прогон генерирует заново — тогда для обновления придётся
сначала удалить старую версию. Один раз собери постоянный keystore и добавь
секреты в репозиторий (Settings → Secrets and variables → Actions):
```bash
keytool -genkeypair -v -keystore ponoi-release.keystore -alias ponoi \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 ponoi-release.keystore > ponoi-release.keystore.b64   # Linux/macOS
# Windows (PowerShell): [Convert]::ToBase64String([IO.File]::ReadAllBytes("ponoi-release.keystore")) | Out-File ponoi-release.keystore.b64
```
Секреты:
- `ANDROID_KEYSTORE_BASE64` — содержимое `ponoi-release.keystore.b64`
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`ponoi` в примере выше), `ANDROID_KEY_PASSWORD`

Храни `ponoi-release.keystore` в надёжном месте вне репозитория — потеряешь его,
и все следующие версии придётся ставить поверх старой уже не получится
(Android требует один и тот же ключ подписи на все версии одного приложения).

Веб-версия (GitHub Pages) уже ставится на телефон и без APK — открой сайт в
браузере телефона → «Добавить на главный экран» (PWA, см. ниже); APK — просто
второй, более «настоящий» вариант того же самого.
