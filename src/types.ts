export interface Profile { id: string; username: string; display_name?: string | null; avatar_color: string | null; avatar_url?: string | null }
export interface Server { id: string; name: string; owner: string; created_at: string; avatar_url?: string | null; accent?: string | null; settings?: any; base_permissions?: number }
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
// v1.223.0: is_group/name/owner_id — групповые беседы (3-10 человек, см.
// src/lib/groupDm.ts). У обычной 1-в-1 беседы is_group=false и они пустые/null.
export interface DMThread { id: string; user_a: string | null; user_b: string | null; created_at: string; is_group?: boolean; name?: string | null; owner_id?: string | null }
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