import { supabase } from '../lib/supabase'
import { colorFor, initial } from '../lib/ui'

export function MeBar({ username }: { username: string }) {
  return (
    <div className="me">
      <span className="me-av" style={{ background: colorFor(username) }}>{initial(username)}</span>
      <span className="me-nm">{username}</span>
      <button className="me-out" onClick={() => supabase.auth.signOut()} title="Выйти">⎋</button>
    </div>
  )
}
