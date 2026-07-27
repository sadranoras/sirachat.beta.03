import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Chat, Profile, ChatMember } from '../lib/types'
import { X, Search, Bookmark, Hash, Users } from 'lucide-react'
import Avatar from './Avatar'

interface ForwardModalProps {
  onClose: () => void
  onForward: (chatId: Chat) => void
}

export default function ForwardModal({ onClose, onForward }: ForwardModalProps) {
  const { user } = useAuth()
  const [chats, setChats] = useState<Chat[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({})

  const loadChats = useCallback(async () => {
    if (!user) return
    const { data: myMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
    if (!myMemberships || myMemberships.length === 0) { setChats([]); setLoading(false); return }
    const chatIds = myMemberships.map(m => (m as any).chat_id)
    const { data: chatsData } = await supabase.from('chats').select('*').in('id', chatIds)
    if (!chatsData) { setChats([]); setLoading(false); return }
    const { data: allMembers } = await supabase.from('chat_members').select('chat_id, user_id').in('chat_id', chatIds)
    const memberUserIds = [...new Set((allMembers || []).map(m => (m as any).user_id))]
    const { data: profilesData } = await supabase.from('profiles').select('*').in('id', memberUserIds)
    const pMap: Record<string, Profile> = {}
    for (const p of (profilesData || []) as Profile[]) pMap[p.id] = p
    setProfileMap(pMap)

    const chatMap: Record<string, Chat & { other_user_id?: string }> = {}
    for (const c of chatsData as Chat[]) chatMap[c.id] = c
    if (allMembers) {
      for (const m of allMembers as ChatMember[]) {
        const c = chatMap[m.chat_id]
        if (!c) continue
        if (c.type === 'direct' && m.user_id !== user.id) (c as any).other_user_id = m.user_id
      }
    }
    for (const c of Object.values(chatMap)) {
      if (c.type === 'direct') {
        const op = pMap[(c as any).other_user_id]
        if (op) { c.title = op.display_name || op.username; c.avatar_url = op.avatar_url }
      }
      if (!c.title) c.title = c.type === 'group' ? 'گروه' : c.type === 'channel' ? 'کانال' : 'گفت‌وگو'
    }

    const sorted = Object.values(chatMap).sort((a, b) => {
      if (a.type === 'saved' && b.type !== 'saved') return -1
      if (b.type === 'saved' && a.type !== 'saved') return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    setChats(sorted)
    setLoading(false)
  }, [user])

  useEffect(() => { loadChats() }, [loadChats])

  const filtered = chats.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const title = (c.title || '').toLowerCase()
    const otherUser = c.type === 'direct' ? profileMap[(c as any).other_user_id] : null
    const phone = (otherUser?.phone || '').toLowerCase()
    const username = (otherUser?.username || '').toLowerCase()
    return title.includes(q) || phone.includes(q) || username.includes(q)
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]">
      <div className="w-full max-w-md h-[80vh] bg-tg-panel rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4 animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center gap-3 p-4 border-b border-tg-border">
          <h2 className="text-tg-text font-semibold flex-1">فروارد به...</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext">
            <X size={20} />
          </button>
        </div>
        <div className="px-4 py-2">
          <div className="relative">
            <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-subtext" />
            <input
              type="text"
              placeholder="جستجو..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-tg-hover rounded-xl pr-10 pl-4 py-2 text-tg-text placeholder-tg-subtext outline-none text-sm"
              autoFocus
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="text-center text-tg-subtext p-4">در حال بارگذاری...</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-tg-subtext text-sm p-8">گفت‌وگویی یافت نشد</p>
          )}
          {filtered.map(chat => {
            const isSaved = chat.type === 'saved'
            const title = isSaved ? 'پیام‌های ذخیره شده' : (chat.title || 'گفت‌وگو')
            return (
              <div
                key={chat.id}
                onClick={() => onForward(chat)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-tg-hover transition-colors"
              >
                <div className="relative flex-shrink-0">
                  {isSaved ? (
                    <div className="w-11 h-11 rounded-full bg-tg-accent/20 flex items-center justify-center">
                      <Bookmark size={22} className="text-tg-accent" />
                    </div>
                  ) : (
                    <>
                      <Avatar url={chat.avatar_url} name={title} size={44} />
                      {chat.type === 'direct' && (
                        <div className="absolute bottom-0 left-0 w-3 h-3 rounded-full border-2 border-tg-panel bg-tg-subtext" />
                      )}
                    </>
                  )}
                </div>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-tg-text font-medium truncate flex items-center gap-1.5">
                    {chat.type === 'channel' && <Hash size={14} className="text-tg-subtext" />}
                    {chat.type === 'group' && !isSaved && <Users size={14} className="text-tg-subtext" />}
                    {title}
                  </p>
                  <p className="text-tg-subtext text-sm truncate">
                    {isSaved ? 'پیام‌های ذخیره‌شده شما' : chat.type === 'direct' ? 'گفت‌وگوی خصوصی' : chat.type === 'group' ? 'گروه' : 'کانال'}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
