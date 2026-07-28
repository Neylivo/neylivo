// v1.333.0: список готовых ботов «от нас» для каталога.
//
// Источник один — supabase/functions/_shared/builtinBots.ts, тот самый файл,
// который выполняет их логику в Edge Function. Здесь только реэкспорт: если бы
// список лежал в двух местах, каталог рано или поздно начал бы обещать бота,
// которого сервер уже не знает (или наоборот). Сама логика (runBuiltinCommand)
// сюда не тянется — приложению она не нужна.
export { BUILTIN_BOTS, builtinBot, isBuiltinKind, type BuiltinBot } from '../../supabase/functions/_shared/builtinBots'
