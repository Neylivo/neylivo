// v1.288.0: имена событий и источников дорожек LiveKit — своими константами.
//
// Зачем: сам пакет livekit-client весит 6.6 МБ из 7.6 МБ всего JS приложения
// (замерено на сборке v1.287.0). Раньше он попадал в главный кусок только потому,
// что DMHome и ServerView импортировали из него enum RoomEvent — ради полутора
// десятков строковых констант тянулась вся библиотека, даже если человек ни разу
// не заходил в звонок. Теперь константы живут здесь, а сам livekit-client
// подгружается динамически в момент входа в звонок (см. joinRoom в livekit.ts).
//
// Значения сверены с установленным пакетом; чтобы они не разъехались при
// обновлении LiveKit молча, есть verifyLivekitConstants() ниже — она вызывается
// при первой реальной загрузке библиотеки.

export const RoomEvent = {
  Connected: 'connected',
  Disconnected: 'disconnected',
  Reconnecting: 'reconnecting',
  Reconnected: 'reconnected',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  ActiveSpeakersChanged: 'activeSpeakersChanged',
  TrackMuted: 'trackMuted',
  TrackUnmuted: 'trackUnmuted',
  TrackPublished: 'trackPublished',
  TrackUnpublished: 'trackUnpublished',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  LocalTrackPublished: 'localTrackPublished',
  LocalTrackUnpublished: 'localTrackUnpublished',
  // Внимание: значение НЕ совпадает с именем ключа (audioPlaybackChanged, не
  // audioPlaybackStatusChanged) — поэтому все константы здесь сверены с пакетом,
  // а не выведены из названий.
  AudioPlaybackStatusChanged: 'audioPlaybackChanged',
} as const

export const Track = {
  Source: {
    Camera: 'camera',
    Microphone: 'microphone',
    ScreenShare: 'screen_share',
    ScreenShareAudio: 'screen_share_audio',
    Unknown: 'unknown',
  },
  Kind: { Audio: 'audio', Video: 'video', Unknown: 'unknown' },
} as const

// Единственное числовое значение из всех — код «отключился сам», по которому
// CallRoom отличает нормальный выход от разрыва связи.
export const DisconnectReason = { CLIENT_INITIATED: 1 } as const
// Одноимённый тип рядом со значением: в обработчиках причина приходит как число
// (`(reason?: DisconnectReason) => ...`), и без этого объявления имя работало бы
// только в значениях, но не в типах.
export type DisconnectReason = number

/**
 * Сверяет наши константы с настоящими, когда livekit-client наконец загрузился.
 * Расхождение означает, что обновление библиотеки переименовало событие — звонки
 * при этом сломались бы тихо и необъяснимо, поэтому кричим в консоль сразу.
 */
export function verifyLivekitConstants(lk: any): void {
  const bad: string[] = []
  for (const [k, v] of Object.entries(RoomEvent)) {
    if (lk?.RoomEvent?.[k] !== v) bad.push(`RoomEvent.${k}: у нас ${v}, в библиотеке ${lk?.RoomEvent?.[k]}`)
  }
  for (const [k, v] of Object.entries(Track.Source)) {
    if (lk?.Track?.Source?.[k] !== v) bad.push(`Track.Source.${k}: у нас ${v}, в библиотеке ${lk?.Track?.Source?.[k]}`)
  }
  if (lk?.DisconnectReason?.CLIENT_INITIATED !== DisconnectReason.CLIENT_INITIATED) {
    bad.push(`DisconnectReason.CLIENT_INITIATED: у нас ${DisconnectReason.CLIENT_INITIATED}, в библиотеке ${lk?.DisconnectReason?.CLIENT_INITIATED}`)
  }
  if (bad.length) {
    console.error('[livekit] Константы разошлись с библиотекой — обнови src/lib/livekitConst.ts:\n' + bad.join('\n'))
  }
}
