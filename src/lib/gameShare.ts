// v1.184.0: «Поделиться игрой» — join-ссылки для игр без установочного
// пайплайна (в отличие от QuickLaunch/Minecraft в src/lib/quicklaunch.ts,
// который качает моды и сам запускает игру, тут — просто открыть диплинк).

// roblox://experiences/start — тот же протокол, что у собственных
// join-ссылок Roblox; с gameInstanceId ведёт прямо на сервер друга (если тот
// ещё не заполнен/жив), без него — просто в плейс (обычный матчмейкинг).
export function robloxJoinUrl(placeId: string, jobId?: string | null): string {
  return jobId
    ? `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${jobId}`
    : `roblox://experiences/start?placeId=${placeId}`
}

// На десктопе — через shell.openExternal (main-процесс), иначе диплинк
// открывает сам браузер (если у пользователя зарегистрирован обработчик roblox://).
export function openGameLink(url: string): void {
  const d = (window as any).ponoiDesktop
  if (d?.openExternal) d.openExternal(url)
  else window.location.href = url
}

// v1.192.0: CS2 (комьюнити-серверы, не матчмейкинг) — тот же диплинк, что и у
// собственной кнопки «Подключиться» Steam, работает даже если игра не запущена
// (Steam сам её стартует). GSI отдаёт только текущий счёт/карту, а не IP
// сервера — адрес хосту приходится вводить вручную (см. ShareGameLinkModal.tsx).
export function steamConnectUrl(ip: string, port: number): string {
  return `steam://connect/${ip}:${port}`
}

// v1.192.0: Terraria — своего диплинк-протокола нет, поэтому находим Terraria.exe
// на диске и запускаем сами (main-процесс, electron/terraria.cjs) с -connect/-port.
export async function terrariaLaunch(ip: string, port: number): Promise<void> {
  const d = (window as any).ponoiDesktop
  if (!d?.terrariaLaunch) throw new Error('Запуск Terraria доступен только в приложении для компьютера')
  const r = await d.terrariaLaunch(ip, port)
  if (r && r.error) throw new Error(r.error)
}
