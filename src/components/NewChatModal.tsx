import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Profile } from '../lib/types'
import { X, Search, Users, User, Megaphone } from 'lucide-react'
import Avatar from './Avatar'

interface NewChatModalProps { onClose: () => void; onChatCreated: (chatId: string) => void }

export default function NewChatModal({ onClose, onChatCreated }: NewChatModalProps) {
  const { user } = useAuth()
  const [mode, setMode] = useState<'select' | 'direct' | 'group' | 'channel'>('select')
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<Profile[]>([])
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([])
  const [groupName, setGroupName] = useState('')
  const [searching, setSearching] = useState(false)

  const searchUsers = async (query: string) => {
    setSearch(query)
    const q = query.trim()
    if (q.length < 1) { setUsers([]); return }
    setSearching(true)
    if (mode === 'direct') {
      // Direct chat: find only by exact username (ID) or exact phone number
      const { data } = await supabase.from('profiles').select('*').or(`username.eq.${q},phone.eq.${q}`).neq('id', user?.id || '').limit(20)
      setUsers(data as Profile[] || [])
      setSearching(false)
      return
    }
    // Group/channel: show my direct-chat contacts first, then all matches
    let contacts: Profile[] = []
    if (user) {
      const { data: myMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
      const myChatIds = (myMemberships || []).map((m: any) => m.chat_id)
      let directPeerIds: string[] = []
      if (myChatIds.length > 0) {
        const { data: myChats } = await supabase.from('chats').select('id, type').in('id', myChatIds).eq('type', 'direct')
        const directChatIds = (myChats || []).map((c: any) => c.id)
        if (directChatIds.length > 0) {
          const { data: peerMembers } = await supabase.from('chat_members').select('user_id').in('chat_id', directChatIds).neq('user_id', user.id)
          directPeerIds = [...new Set((peerMembers || []).map((m: any) => m.user_id))]
        }
      }
      if (directPeerIds.length > 0) {
        const { data: contactProfiles } = await supabase.from('profiles').select('*').in('id', directPeerIds).or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        contacts = (contactProfiles as Profile[]) || []
      }
      const { data: allMatches } = await supabase.from('profiles').select('*').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).neq('id', user?.id || '').limit(20)
      const allMap = new Map<string, Profile>()
      for (const p of contacts) allMap.set(p.id, p)
      for (const p of (allMatches as Profile[]) || []) allMap.set(p.id, p)
      setUsers([...allMap.values()].slice(0, 20))
    } else {
      setUsers([])
    }
    setSearching(false)
  }

  const startDirectChat = async (otherUser: Profile) => {
    if (!user) return
    const { data: existingMembers } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
    if (existingMembers) {
      for (const m of existingMembers as any[]) {
        const { data: chatData } = await supabase.from('chats').select('type').eq('id', m.chat_id).single()
        if (chatData && chatData.type === 'direct') {
          const { data: otherMember } = await supabase.from('chat_members').select('user_id').eq('chat_id', m.chat_id).neq('user_id', user.id).limit(1)
          if (otherMember && otherMember.length > 0 && otherMember[0].user_id === otherUser.id) { onChatCreated(m.chat_id); return }
        }
      }
    }
    const { data: chat } = await supabase.from('chats').insert({ type: 'direct', title: null, created_by: user.id }).select().single()
    if (!chat) return
    await supabase.from('chat_members').insert([{ chat_id: chat.id, user_id: user.id, role: 'owner' }, { chat_id: chat.id, user_id: otherUser.id, role: 'member' }])
    onChatCreated(chat.id)
  }

  const createGroup = async () => {
    if (!user || selectedUsers.length === 0 || !groupName.trim()) return
    const { data: chat } = await supabase.from('chats').insert({ type: 'group', title: groupName, created_by: user.id }).select().single()
    if (!chat) return
    await supabase.from('chat_members').insert([{ chat_id: chat.id, user_id: user.id, role: 'owner' }, ...selectedUsers.map(u => ({ chat_id: chat.id, user_id: u.id, role: 'member' }))])
    onChatCreated(chat.id)
  }

  const createChannel = async () => {
    if (!user || !groupName.trim()) return
    const { data: chat } = await supabase.from('chats').insert({ type: 'channel', title: groupName, created_by: user.id }).select().single()
    if (!chat) return
    const memberRows = [{ chat_id: chat.id, user_id: user.id, role: 'owner' }, ...selectedUsers.map(u => ({ chat_id: chat.id, user_id: u.id, role: 'member' }))]
    await supabase.from('chat_members').insert(memberRows)
    onChatCreated(chat.id)
  }

  const toggleUser = (u: Profile) => setSelectedUsers(prev => prev.find(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u])

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-tg-panel rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-tg-hover">
          <h2 className="text-lg font-bold text-tg-text">{mode === 'select' ? 'گفت‌وگوی جدید' : mode === 'group' ? 'گروه جدید' : mode === 'channel' ? 'کانال جدید' : 'کاربر را انتخاب کنید'}</h2>
          <button onClick={onClose} className="text-tg-subtext hover:text-tg-text"><X size={20} /></button>
        </div>
        {mode === 'select' && (
          <div className="p-4 space-y-2">
            <button onClick={() => setMode('direct')} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-tg-hover transition-colors">
              <div className="w-12 h-12 rounded-full bg-tg-accent flex items-center justify-center"><User size={22} className="text-white" /></div>
              <span className="text-tg-text font-medium">گفت‌وگوی خصوصی</span>
            </button>
            <button onClick={() => setMode('group')} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-tg-hover transition-colors">
              <div className="w-12 h-12 rounded-full bg-tg-green flex items-center justify-center"><Users size={22} className="text-white" /></div>
              <span className="text-tg-text font-medium">گروه جدید</span>
            </button>
            <button onClick={() => setMode('channel')} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-tg-hover transition-colors">
              <div className="w-12 h-12 rounded-full bg-tg-blue flex items-center justify-center"><Megaphone size={22} className="text-white" /></div>
              <span className="text-tg-text font-medium">کانال جدید</span>
            </button>
          </div>
        )}
        {(mode === 'direct' || mode === 'group' || mode === 'channel') && (
          <>
            {(mode === 'group' || mode === 'channel') && (
              <div className="p-3 border-b border-tg-hover">
                <input type="text" placeholder={mode === 'channel' ? 'نام کانال' : 'نام گروه'} value={groupName} onChange={e => setGroupName(e.target.value)} className="w-full bg-tg-hover rounded-xl px-4 py-2.5 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" />
              </div>
            )}
            {mode === 'channel' && (
              <p className="px-4 py-2 text-xs text-tg-subtext bg-tg-hover/50">در کانال فقط مدیران می‌توانند پیام ارسال کنند. مشترکین فقط پیام‌ها را می‌بینند.</p>
            )}
            {(mode === 'group' || mode === 'channel') && selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 border-b border-tg-hover">
                {selectedUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-1 bg-tg-active rounded-full px-2 py-1">
                    <span className="text-sm text-tg-text">{u.username}</span>
                    <button onClick={() => toggleUser(u)} className="text-tg-subtext hover:text-tg-red"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="p-3 border-b border-tg-hover">
              <div className="relative">
                <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-subtext" />
                <input type="text" placeholder="جستجوی کاربر..." value={search} onChange={e => searchUsers(e.target.value)} className="w-full bg-tg-hover rounded-xl pr-10 pl-4 py-2.5 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {searching && <p className="text-center text-tg-subtext p-4">در حال جستجو...</p>}
              {!searching && users.length === 0 && search && <p className="text-center text-tg-subtext p-4">کاربری یافت نشد</p>}
              {users.map(u => (
                <button key={u.id} onClick={() => mode === 'direct' ? startDirectChat(u) : toggleUser(u)} className="w-full flex items-center gap-3 p-3 hover:bg-tg-hover transition-colors text-right">
                  <Avatar url={u.avatar_url} name={u.display_name || u.username || ''} size={40} />
                  <div className="flex-1 text-right">
                    <p className="text-tg-text font-medium">{u.display_name || u.username || 'بدون نام'}</p>
                    <p className="text-tg-subtext text-sm">{u.username ? `@${u.username}` : 'بدون آیدی'}</p>
                  </div>
                  {mode === 'group' && selectedUsers.find(s => s.id === u.id) && (
                    <div className="w-6 h-6 rounded-full bg-tg-accent flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {mode === 'group' && selectedUsers.length > 0 && groupName.trim() && (
              <div className="p-3 border-t border-tg-hover">
                <button onClick={createGroup} className="w-full bg-tg-accent hover:bg-tg-accent2 text-white font-semibold rounded-xl py-3 transition-colors">ایجاد گروه ({selectedUsers.length + 1} نفر)</button>
              </div>
            )}
            {mode === 'channel' && groupName.trim() && (
              <div className="p-3 border-t border-tg-hover">
                <button onClick={createChannel} className="w-full bg-tg-blue hover:opacity-90 text-white font-semibold rounded-xl py-3 transition-colors">ایجاد کانال{selectedUsers.length > 0 ? ` (${selectedUsers.length + 1} نفر)` : ''}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
