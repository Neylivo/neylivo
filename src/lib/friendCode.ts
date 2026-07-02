// Deterministic friend code (discriminator) derived from a user's UUID.
// The 4-digit tag is a pure function of the user id, so no DB column is needed
// and the same user always yields the same code across devices.
export function tagFor(userId: string): string {
  let h = 2166136261 >>> 0
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const n = (h % 9000) + 1000
  return String(n)
}

export function friendCode(username: string, userId: string): string {
  return `${username}#${tagFor(userId)}`
}

// Parse "Имя#7401" -> { name, tag }; tolerant of surrounding whitespace.
export function parseFriendCode(input: string): { name: string; tag: string } | null {
  const m = input.trim().match(/^(.*?)#(\d{3,5})$/)
  if (!m) return null
  return { name: m[1].trim(), tag: m[2] }
}
