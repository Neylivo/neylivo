// v1.384.0: какой у файла тип, если браузер его не подставил.
//
// Отдельным файлом без зависимостей: правило проверяется тестом, а тянуть туда
// модуль, которому нужен настроенный сервер, нельзя.
//
// Зачем вообще. File.type появляется не всегда: у файла из буфера обмена, из
// перетаскивания и у собранного в коде его может не быть. Пустой тип уезжает на
// сервер как application/octet-stream и остаётся там навсегда, а хранилище
// отдаёт файл с запретом угадывать тип — картинка просто не показывается. Со
// стороны это выглядит как «фото не отправляются».

const BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
}

export function contentTypeOf(file: { name: string; type?: string }): string {
  if (file.type) return file.type
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  return BY_EXT[ext] ?? 'application/octet-stream'
}
