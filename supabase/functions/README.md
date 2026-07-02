# Supabase Edge Functions

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
5. Задеплой функцию:
   ```bash
   supabase functions deploy livekit-token --no-verify-jwt
   ```

Клиент вызывает её через `supabase.functions.invoke('livekit-token', { body: { room, identity, name } })`.
