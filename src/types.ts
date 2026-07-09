export interface Profile { id: string; username: string; display_name?: string | null; avatar_color: string | null; avatar_url?: string | null }
export interface Server { id: string; name: string; owner: string; created_at: string; avatar_url?: string | null; accent?: string | null; settings?: any }
export interface Channel { id: string; server_id: string; name: string; kind?: string | null; topic?: string | null; settings?: any }
export interface Message {
  id: string
  channel_id: string
  author: string
  author_name: string
  content: string
  created_at: string
  attach_url?: string | null
  attach_type?: string | null
  attach_meta?: ({ name?: string; desc?: string } | null)[] | null
  pinned?: boolean
  reply_to?: string | null
  reply_author?: string | null
  reply_preview?: string | null
  edited?: boolean
}

export interface FriendRequest {
  id: string
  from_user: string
  to_user: string
  from_name: string
  to_name: string
  status: string
  created_at: string
}
export interface DMThread { id: string; user_a: string; user_b: string; created_at: string }
export interface DMMessage {
  id: string
  thread_id: string
  author: string
  author_name: string
  content: string
  created_at: string
  attach_url?: string | null
  attach_type?: string | null
  attach_meta?: ({ name?: string; desc?: string } | null)[] | null
  pinned?: boolean
  reply_to?: string | null
  reply_author?: string | null
  reply_preview?: string | null
  edited?: boolean
}