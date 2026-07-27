export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  created_at: string
  is_admin: boolean
  is_owner: boolean
  bio: string | null
  last_seen: string | null
  phone: string | null
  phone_visible: boolean
  is_blocked: boolean
  is_online: boolean
}

export interface Chat {
  id: string
  type: 'direct' | 'group' | 'channel' | 'saved'
  title: string | null
  avatar_url: string | null
  created_by: string
  created_at: string
  description: string | null
  username: string | null
  is_private: boolean
  invite_token: string | null
}

export interface ChatMember {
  chat_id: string
  user_id: string
  joined_at: string
  role: string
}

export interface Reaction {
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface ReadReceipt {
  message_id: string
  user_id: string
  read_at: string
}

export interface Message {
  id: string
  chat_id: string
  sender_id: string
  content: string
  created_at: string
  message_type: string
  file_url: string | null
  file_name: string | null
  file_size: number | null
  duration: number | null
  is_edited: boolean
  is_pinned: boolean
  reply_to: string | null
  deleted_at: string | null
  read_at: string | null
  sender?: Profile
  reactions?: Reaction[]
  reply_to_message?: Message | null
  read_receipts?: ReadReceipt[]
}

export interface Call {
  id: string
  chat_id: string
  caller_id: string
  callee_id: string
  status: string
  offer_sdp: string | null
  answer_sdp: string | null
  caller_candidates: any[]
  callee_candidates: any[]
  created_at: string
  updated_at: string
  video: boolean
  offer_version?: number
  switch_request?: { to_video: boolean; requested_by: string; status: 'pending' | 'accepted' | 'rejected' } | null
  is_group_call?: boolean
}

export interface CallParticipant {
  id: string
  call_id: string
  user_id: string
  joined_at: string
  left_at: string | null
  video_enabled: boolean
  audio_enabled: boolean
}

export interface CallSignal {
  id: string
  call_id: string
  from_user: string
  to_user: string
  type: 'offer' | 'answer' | 'candidate' | 'renegotiate'
  payload: any
  created_at: string
}

export interface CallCandidate {
  id: string
  call_id: string
  user_id: string
  candidate: any
  created_at: string
}

export interface Report {
  id: string
  reporter_id: string
  reported_id: string
  reason: string
  description: string | null
  status: string
  created_at: string
  reported: Profile
}
