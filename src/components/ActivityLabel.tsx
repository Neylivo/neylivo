import { useEffect, useState } from 'react'
import type { Activity } from '../lib/presence'

// «2 ч 34 мин 1 сек» — сколько длится активность.
export function fmtElapsed(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  if (h > 0) return h + ' ч ' + m + ' мин ' + ss + ' сек'
  if (m > 0) return m + ' мин ' + ss + ' сек'
  return ss + ' сек'
}

// Живая строка активности: «Играю в Doom — 2 ч 34 мин 1 сек», тикает каждую секунду.
export function ActivityLabel({ activity }: { activity: Activity }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  return <>{activity.text} — {fmtElapsed(activity.since)}</>
}
