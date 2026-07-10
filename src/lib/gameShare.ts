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
