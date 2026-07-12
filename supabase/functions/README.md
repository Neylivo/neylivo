# Supabase Edge Functions

## login-by-username
Вход по юзернейму (не только по почте) — резолвит юзернейм в почту и логинит
ОДНИМ шагом на сервере, почта никогда не попадает в браузер. Без неё поле
«Юзернейм или почта» на экране входа принимает только почту — попытка войти
юзернеймом падает с «Неверная почта/юзернейм или пароль», даже если пароль верный.

### Что нужно один раз сделать
Секретов/настройки не требует — только сам деплой, **обязательно** с
`--no-verify-jwt` (функция вызывается ДО того, как у пользователя появится сессия,
как и обычный вход):
```bash
supabase functions deploy login-by-username --no-verify-jwt
```

## livekit-token
Выдаёт токен для входа в комнату LiveKit (звонки/видео/демонстрация экрана).

### Что нужно один раз сделать
1. Заведи бесплатный проект на https://cloud.livekit.io — получишь:
   - `LIVEKIT_URL` (вида `wss://xxxx.livekit.cloud`)
   - `API Key` и `API Secret`
2. Установи Supabase CLI: https://supabase.com/docs/guides/cli
3. Залогинься и привяжи проект:
   ```bash
   supabase login
   supabase link --project-ref <твой project ref>
   ```
4. Задай секреты:
   ```bash
   supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_URL=wss://xxxx.livekit.cloud
   ```
5. Задеплой функцию (БЕЗ `--no-verify-jwt` — функция сама проверяет JWT и
   членство в сервере/DM-треде запрашиваемой комнаты):
   ```bash
   supabase functions deploy livekit-token
   ```

Клиент вызывает её через `supabase.functions.invoke('livekit-token', { body: { room, identity, name } })`.

## send-push
Шлёт настоящие web-push уведомления (приходят даже когда приложение полностью
закрыто/не открыт браузер) — DM-сообщение, приглашение на сервер, @упоминание.
Фильтрует получателей по их личным настройкам (заглушка сервера/канала/ЛС, режим
«только @упоминания») — см. комментарии в `supabase/functions/send-push/index.ts`.

### Что нужно один раз сделать
1. Сгенерируй пару VAPID-ключей:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Задай секреты (Public/Private — из вывода команды выше; Subject — твоя почта):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
   ```
3. Публичный ключ — ещё и в `.env` (`VITE_VAPID_PUBLIC_KEY=...`, тот же, что в шаге 1)
   и в GitHub → Settings → Secrets and variables → Actions (тем же именем) — без
   него клиент даже не подписывается на пуши (браузер должен знать публичный ключ,
   чтобы получать шифрованные сообщения от него).
4. Задеплой функцию:
   ```bash
   supabase functions deploy send-push
   ```

Если позже нужно перевыпустить ключи (например, скомпрометировали) — сгенерируй
заново, обнови секрет в Supabase И везде, где лежит `VITE_VAPID_PUBLIC_KEY`
(`.env`, GitHub secret) — иначе уже подписанные устройства перестанут получать пуши,
пока не переподпишутся (произойдёт само при следующем входе).
