-- v1.354.0: доставка событий ботам без Dashboard.
--
-- Зачем. Функция bot-dispatch рассылает ботам событие «в канал пришло сообщение»,
-- но сама себя она не позовёт — её должен дёргать триггер на таблице messages.
-- В README для этого предлагался Database Webhook из Dashboard, но в новых
-- панелях этот раздел переехал и находится не у всех. Здесь ровно то же самое
-- обычным SQL: тот же pg_net, тот же заголовок с секретом — просто вставляется
-- в SQL Editor, как остальные миграции.
--
-- ПЕРЕД применением заменить два места ниже:
--   <АДРЕС_ФУНКЦИИ> — https://<ref>.supabase.co/functions/v1/bot-dispatch
--   <СЕКРЕТ>        — то же значение, что задано функции bot-dispatch как
--                     переменная окружения DB_WEBHOOK_SECRET.
-- Секрет намеренно не лежит в этом файле: он попал бы в git.
--
-- Без совпадающего секрета bot-dispatch отвечает 403 и ничего не делает — она
-- залита без проверки входа, и иначе кто угодно слал бы туда поддельные события
-- и заставлял нас подписывать чужой текст настоящим ключом бота.

create extension if not exists pg_net with schema extensions;

create or replace function public.bot_dispatch_hook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
begin
  -- Тело — ровно та форма, которую шлёт штатный Database Webhook и которую
  -- разбирает bot-dispatch: {type, table, record}.
  perform net.http_post(
    url     := '<АДРЕС_ФУНКЦИИ>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', '<СЕКРЕТ>'
    ),
    body    := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', to_jsonb(new)
    )
  );
  return new;
exception when others then
  -- Отправка сообщения не должна падать из-за ботов. Если вызов не удался —
  -- сообщение всё равно сохраняется, просто бот о нём не узнает.
  return new;
end;
$$;

-- Эхо-циклы («бот отвечает на своё же сообщение») отсекает сама функция
-- bot-dispatch — она проверяет, не бот ли автор. Здесь фильтровать нечего.
drop trigger if exists bot_dispatch_on_message on public.messages;
create trigger bot_dispatch_on_message
  after insert on public.messages
  for each row execute function public.bot_dispatch_hook();

-- Звать функцию может только триггер, не пользователи через API.
revoke all on function public.bot_dispatch_hook() from public, anon, authenticated;
