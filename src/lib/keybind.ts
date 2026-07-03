// Tiny keybind helper: turn a KeyboardEvent into a stable combo string
// (e.g. "Alt+S", "Ctrl+Shift+K") and match one against a stored combo.
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.metaKey) parts.push('Meta')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const k = e.key
  if (k === 'Control' || k === 'Meta' || k === 'Alt' || k === 'Shift') return parts.join('+')
  parts.push(k === ' ' ? 'Space' : (k.length === 1 ? k.toUpperCase() : k))
  return parts.join('+')
}

// A combo is "complete" only once it ends in a non-modifier key.
export function isComboComplete(combo: string): boolean {
  if (!combo) return false
  const last = combo.split('+').pop() ?? ''
  return last !== '' && last !== 'Ctrl' && last !== 'Meta' && last !== 'Alt' && last !== 'Shift'
}

export function matchCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  return comboFromEvent(e).toLowerCase() === combo.toLowerCase()
}