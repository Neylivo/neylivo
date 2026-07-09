// Call audio capture + soundboard playback for Ponoi voice channels.
//
// CallRecorder keeps a rolling ring buffer (mono Float32) of the *mixed* call
// audio — the local mic plus every subscribed remote audio track — so that at
// any moment we can grab "the last N seconds" of the conversation and encode it
// to WAV (see soundboard.ts). Uses a ScriptProcessorNode fed by a silent sink
// so it runs without echoing remote audio (which is already played by CallRoom).
//
// playToAll() takes a saved clip URL, decodes it, and publishes it as a LiveKit
// audio track so everyone in the room hears it, while also playing it locally
// for the person who triggered it. The track is unpublished when playback ends.
import { Room, Track } from './livekit'
import { audioCtx, master } from './callSounds'

export class CallRecorder {
  ctx: AudioContext
  private mixer: GainNode
  private sink: GainNode
  private proc: ScriptProcessorNode
  private ring: Float32Array
  private size: number
  private writePos = 0
  private filled = 0
  private sources = new Map<string, MediaStreamAudioSourceNode>()
  sampleRate: number
  ok = false

  constructor(seconds = 20) {
    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    this.ctx = new Ctx()
    this.sampleRate = this.ctx.sampleRate
    this.size = Math.max(1, Math.ceil(this.sampleRate * seconds))
    this.ring = new Float32Array(this.size)
    this.mixer = this.ctx.createGain()
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1)
    this.proc.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0)
      for (let i = 0; i < input.length; i++) {
        this.ring[this.writePos] = input[i]
        this.writePos = (this.writePos + 1) % this.size
        if (this.filled < this.size) this.filled++
      }
    }
    // sources -> mixer -> proc -> (silent) sink -> destination
    this.mixer.connect(this.proc)
    this.proc.connect(this.sink)
    this.sink.connect(this.ctx.destination)
    this.ok = true
  }

  addTrack(track: MediaStreamTrack | undefined | null, id: string) {
    if (!track || track.kind !== 'audio' || this.sources.has(id)) return
    try {
      const src = this.ctx.createMediaStreamSource(new MediaStream([track]))
      src.connect(this.mixer)
      this.sources.set(id, src)
    } catch {}
  }

  removeTrack(id: string) {
    const s = this.sources.get(id)
    if (s) { try { s.disconnect() } catch {}; this.sources.delete(id) }
  }

  async resume() { try { await this.ctx.resume() } catch {} }

  // Grab the last `sec` seconds of mixed audio as mono Float32.
  snapshot(sec = 15): Float32Array {
    const want = Math.min(this.filled, Math.ceil(this.sampleRate * sec))
    const out = new Float32Array(want)
    let pos = (this.writePos - want + this.size) % this.size
    for (let i = 0; i < want; i++) { out[i] = this.ring[pos]; pos = (pos + 1) % this.size }
    return out
  }

  close() {
    try { this.proc.disconnect() } catch {}
    try { this.mixer.disconnect() } catch {}
    try { this.sink.disconnect() } catch {}
    for (const s of this.sources.values()) { try { s.disconnect() } catch {} }
    this.sources.clear()
    try { this.ctx.close() } catch {}
    this.ok = false
  }
}

// Publish a clip into the room so everyone hears it; also play locally.
// Returns a stop() function to cut playback early. Resolves when done.
export async function playToAll(
  room: Room,
  url: string,
  opts: { onEnded?: () => void } = {},
): Promise<{ stop: () => void }> {
  // v1.150.0: раньше локальный мониторинг шёл в свой отдельный AudioContext напрямую
  // на destination, в обход общего master()-гейна — из-за этого «заглушить всех»
  // (deafen) не приглушало собственное прослушивание запущенного звука саундборда.
  // Теперь используем общий контекст приложения и подключаемся через master().
  const ctx = audioCtx()
  const resp = await fetch(url)
  const arr = await resp.arrayBuffer()
  const buf = await ctx.decodeAudioData(arr)
  const dest = ctx.createMediaStreamDestination()
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(dest)
  src.connect(master()) // local monitor for the presser — through the shared deafen-aware gain
  const track = dest.stream.getAudioTracks()[0]

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try { room.localParticipant.unpublishTrack(track) } catch {}
    try { src.stop() } catch {}
    // ctx общий на всё приложение (audioCtx()) — не закрываем его здесь.
    opts.onEnded?.()
  }

  try {
    await room.localParticipant.publishTrack(track, { name: 'soundboard', source: Track.Source.Unknown as any })
  } catch {
    // even if publish fails, still play locally
  }
  src.onended = cleanup
  src.start()
  return { stop: cleanup }
}