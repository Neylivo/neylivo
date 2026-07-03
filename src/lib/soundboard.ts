// Shared soundboard ("Саундпад · Моменты"): saved audio clips everyone can see,
// play, and blast into a voice channel. Clips live in the `soundboard_clips`
// table (+ WAV/audio files in the public `attachments` Storage bucket) and are
// kept in sync via Supabase realtime, just like the shared music library.
import { supabase } from './supabase'
import { uploadTo } from './storage'
import type { CallRecorder } from './callAudio'

export interface Clip {
  id: string
  url: string
  name: string
  owner: string        // display name (owner_name) when available, else uid
  ownerId: string
  duration: number     // seconds
  created_at: string
}

export async function fetchClips(): Promise<Clip[]> {
  const { data } = await supabase.from('soundboard_clips').select('*').order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map(r => ({
    id: r.id as string,
    url: r.url as string,
    name: r.name as string,
    owner: (r.owner_name || r.owner) as string,
    ownerId: r.owner as string,
    duration: Number(r.duration ?? 0),
    created_at: r.created_at as string,
  }))
}

export async function addClip(c: { url: string; name: string; ownerId: string; ownerName: string; duration: number }) {
  return supabase.from('soundboard_clips')
    .insert({ url: c.url, name: c.name, owner: c.ownerId, owner_name: c.ownerName, duration: Math.round(c.duration * 100) / 100 })
    .select().single()
}

export async function removeClip(id: string) {
  return supabase.from('soundboard_clips').delete().eq('id', id)
}

// ---------- WAV encoding / decoding / trimming ----------

function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
}

// Encode mono Float32 PCM samples into a 16-bit WAV Blob.
export function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)          // PCM
  view.setUint16(22, 1, true)          // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Blob([view], { type: 'audio/wav' })
}

// Decode any audio (blob/arraybuffer) into an AudioBuffer for preview/trim.
export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const ctx = new Ctx()
  try {
    return await ctx.decodeAudioData(data.slice(0))
  } finally {
    try { ctx.close() } catch {}
  }
}

// Mix an AudioBuffer (optionally a [start,end] second range) down to mono WAV.
export function audioBufferToWav(buf: AudioBuffer, start = 0, end = buf.duration): Blob {
  const sr = buf.sampleRate
  const s0 = Math.max(0, Math.floor(start * sr))
  const s1 = Math.min(buf.length, Math.floor(end * sr))
  const len = Math.max(0, s1 - s0)
  const out = new Float32Array(len)
  const chs = buf.numberOfChannels || 1
  for (let ch = 0; ch < chs; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) out[i] += d[s0 + i] / chs
  }
  return encodeWavMono(out, sr)
}

export function fmtDur(s: number): string {
  if (!isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60), ss = Math.floor(s % 60)
  return m + ':' + String(ss).padStart(2, '0')
}

// Capture the last `seconds` of the ongoing call, encode to WAV, upload to the
// shared `attachments` bucket, and record a row in `soundboard_clips`. Shared by
// the soundboard panel button and the in-call hotkey. Throws on failure.
export async function saveMoment(
  recorder: CallRecorder | null,
  meId: string,
  meName: string,
  seconds = 15,
): Promise<void> {
  if (!recorder || !recorder.ok) throw new Error('Запись доступна только в активном звонке')
  await recorder.resume()
  const samples = recorder.snapshot(seconds)
  if (!samples.length) throw new Error('Пока нечего сохранять — говорите подольше')
  const blob = encodeWavMono(samples, recorder.sampleRate)
  const dur = samples.length / recorder.sampleRate
  const name = 'Момент ' + new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const file = new File([blob], name.replace(/[^\w]+/g, '_') + '.wav', { type: 'audio/wav' })
  const url = await uploadTo('attachments', meId, file)
  await addClip({ url, name, ownerId: meId, ownerName: meName, duration: dur })
}