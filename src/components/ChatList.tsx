import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Chat, Profile, ChatMember } from '../lib/types'
import { Plus, Search, Settings, Trash2, Shield, Download, Hash, Users, Bookmark } from 'lucide-react'
import Avatar from './Avatar'
import InstallModal from './InstallModal'

interface ChatListProps { selectedId: string; onSelect: (id: string) => void; onNewChat: () => void; onSettings: () => void; onAdmin: () => void; onPreviewChat: (id: string) => void }
interface ChatWithMeta extends Chat { other_user?: Profile | null; last_message?: string | null; last_message_time?: string | null; other_online?: boolean; unread_count?: number }

export default function ChatList({ selectedId, onSelect, onNewChat, onSettings, onAdmin, onPreviewChat }: ChatListProps) {
  const { user, profile } = useAuth()
  const [chats, setChats] = useState<ChatWithMeta[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [menuChatId, setMenuChatId] = useState<string | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [publicResults, setPublicResults] = useState<Chat[]>([])
  const [searchingPublic, setSearchingPublic] = useState(false)

  const loadChats = useCallback(async () => {
    if (!user) return
    const { data: myMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
    if (!myMemberships || myMemberships.length === 0) { setChats([]); setLoading(false); return }
    const chatIds = myMemberships.map(m => (m as any).chat_id)
    const { data: chatsData } = await supabase.from('chats').select('*').in('id', chatIds)
    if (!chatsData) { setChats([]); setLoading(false); return }
    const { data: allMembers } = await supabase.from('chat_members').select('chat_id, user_id, role').in('chat_id', chatIds)
    const memberUserIds = (allMembers || []).map(m => (m as any).user_id)
    const uniqueUserIds = [...new Set(memberUserIds)]
    const { data: profilesData } = await supabase.from('profiles').select('*').in('id', uniqueUserIds)
    const profileMap: Record<string, Profile> = {}
    for (const p of (profilesData || []) as Profile[]) profileMap[p.id] = p
    const chatMap: Record<string, ChatWithMeta> = {}
    for (const c of chatsData as Chat[]) chatMap[c.id] = { ...c, other_user: null, other_online: false }
    if (allMembers) {
      for (const m of allMembers as ChatMember[]) {
        const c = chatMap[m.chat_id]; if (!c) continue
        if (c.type === 'direct' && m.user_id !== user.id) {
          const op = profileMap[m.user_id]
          if (op) { c.other_user = op; c.other_online = op.is_online || false }
        }
      }
    }
    for (const c of Object.values(chatMap)) {
      if (c.type === 'direct' && c.other_user) { c.title = c.other_user.display_name || c.other_user.username; c.avatar_url = c.other_user.avatar_url }
      if (!c.title) c.title = c.type === 'group' ? 'گروه' : 'گفت‌وگو'
    }
    const { data: lastMsgs } = await supabase.from('messages').select('chat_id, content, created_at, deleted_at, message_type, file_name').in('chat_id', chatIds).order('created_at', { ascending: false }).limit(50)
    if (lastMsgs) {
      for (const msg of lastMsgs as any[]) {
        const c = chatMap[msg.chat_id]
        if (c && !c.last_message_time) {
          c.last_message_time = msg.created_at
          if (msg.deleted_at) c.last_message = 'پیام حذف شد'
          else if (msg.message_type === 'image') c.last_message = '📷 تصویر'
          else if (msg.message_type === 'file') c.last_message = '📎 فایل'
          else if (msg.message_type === 'voice') c.last_message = '🎤 پیام صوتی'
          else if (msg.message_type === 'call') c.last_message = msg.content || 'تماس'
          else c.last_message = msg.content
        }
      }
    }
    const sorted = Object.values(chatMap).sort((a, b) => {
      // Saved Messages always at the top
      if (a.type === 'saved' && b.type !== 'saved') return -1
      if (b.type === 'saved' && a.type !== 'saved') return 1
      const aTime = a.last_message_time ? new Date(a.last_message_time).getTime() : new Date(a.created_at).getTime()
      const bTime = b.last_message_time ? new Date(b.last_message_time).getTime() : new Date(b.created_at).getTime()
      return bTime - aTime
    })
    setChats(sorted); setLoading(false)
  }, [user])

  const loadUnreadCounts = useCallback(async () => {
    if (!user) return
    const { data: myMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
    if (!myMemberships || myMemberships.length === 0) { setUnreadCounts({}); return }
    const chatIds = myMemberships.map(m => (m as any).chat_id)
    const { data: unreadMsgs } = await supabase.from('messages')
      .select('chat_id')
      .in('chat_id', chatIds)
      .neq('sender_id', user.id)
      .is('read_at', null)
      .is('deleted_at', null)
    const counts: Record<string, number> = {}
    for (const m of (unreadMsgs || []) as any[]) {
      counts[m.chat_id] = (counts[m.chat_id] || 0) + 1
    }
    setUnreadCounts(counts)
  }, [user])

  useEffect(() => { loadChats(); loadUnreadCounts() }, [loadChats, loadUnreadCounts])

  useEffect(() => {
    const channel = supabase.channel('chat_list_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members', filter: `user_id=eq.${user?.id || ''}` }, loadChats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, loadChats)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => { loadChats(); loadUnreadCounts() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => { loadChats(); loadUnreadCounts() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => loadChats())
      .subscribe()
    const reloadHandler = () => { loadChats(); loadUnreadCounts() }
    window.addEventListener('chat-list-reload', reloadHandler)
    return () => { supabase.removeChannel(channel); window.removeEventListener('chat-list-reload', reloadHandler) }
  }, [loadChats, loadUnreadCounts, user?.id])

  const deleteChat = async (chatId: string, isOwner: boolean) => {
    if (!user) return
    if (isOwner) {
      await supabase.from('chat_members').delete().eq('chat_id', chatId)
      await supabase.from('chats').delete().eq('id', chatId)
    } else {
      await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', user.id)
    }
    setChats(prev => prev.filter(c => c.id !== chatId))
    if (selectedId === chatId) onSelect('')
    setMenuChatId(null)
  }

  const filtered = chats.filter(c => {
    const q = search.toLowerCase()
    const title = (c.title || '').toLowerCase()
    const phone = (c.other_user?.phone || '').toLowerCase()
    const username = (c.other_user?.username || '').toLowerCase()
    return title.includes(q) || phone.includes(q) || username.includes(q)
  })

  // Search public chats the user is NOT a member of
  useEffect(() => {
    if (!user || !search.trim()) { setPublicResults([]); return }
    setSearchingPublic(true)
    const q = search.trim().toLowerCase()
    const timer = setTimeout(async () => {
      const { data: myMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
      const memberIds = new Set((myMemberships || []).map((m: any) => m.chat_id))
      const { data: publicChats } = await supabase.from('chats')
        .select('*')
        .in('type', ['group', 'channel'])
        .eq('is_private', false)
        .or(`title.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(20)
      const nonMember = (publicChats || []).filter((c: any) => !memberIds.has(c.id)) as Chat[]
      setPublicResults(nonMember)
      setSearchingPublic(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, user])

  return (
    <div className="w-full md:w-80 md:max-w-80 h-full bg-tg-panel flex flex-col border-l border-tg-border relative">
      <div className="flex items-center gap-2 p-3 bg-tg-panel">
        <h1 className="text-lg font-bold text-tg-text flex-1">سیرا چت</h1>
        {profile?.is_admin && <button onClick={onAdmin} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-accent" title="پنل مدیریت"><Shield size={20} /></button>}
        <button onClick={() => setShowInstall(true)} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext" title="نصب اپ"><Download size={20} /></button>
        <button onClick={onSettings} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext" title="تنظیمات"><Settings size={20} /></button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-subtext" />
          <input type="text" placeholder="جستجو..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-tg-hover rounded-xl pr-10 pl-4 py-2 text-tg-text placeholder-tg-subtext outline-none text-sm" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-center text-tg-subtext p-4">در حال بارگذاری...</p>}
        {!loading && filtered.length === 0 && publicResults.length === 0 && !searchingPublic && (
          <div className="text-center p-8">
            <p className="text-tg-subtext text-sm">گفت‌وگویی وجود ندارد</p>
            <button onClick={onNewChat} className="mt-3 text-tg-accent text-sm hover:underline">شروع گفت‌وگوی جدید</button>
          </div>
        )}
        {filtered.map(chat => {
          const isOwner = chat.created_by === user?.id
          const isSaved = chat.type === 'saved'
          const title = isSaved ? 'پیام‌های ذخیره شده' : (chat.title || 'گفت‌وگو')
          const isOnline = chat.type === 'direct' && chat.other_online
          return (
            <div key={chat.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors relative ${selectedId === chat.id ? 'bg-tg-active' : 'hover:bg-tg-hover'}`} onClick={() => onSelect(chat.id)}>
              <div className="relative">
                {isSaved ? (
                  <div className="w-12 h-12 rounded-full bg-tg-accent/20 flex items-center justify-center flex-shrink-0">
                    <Bookmark size={24} className="text-tg-accent" />
                  </div>
                ) : (
                  <>
                    <Avatar url={chat.avatar_url} name={title} size={48} />
                    {chat.type === 'direct' && <div className={`absolute bottom-0 left-0 w-3.5 h-3.5 rounded-full border-2 border-tg-panel ${isOnline ? 'bg-tg-green' : 'bg-tg-subtext'}`} />}
                  </>
                )}
              </div>
              <div className="flex-1 min-w-0 text-right">
                <p className="text-tg-text font-medium truncate">{title}</p>
                <p className="text-tg-subtext text-sm truncate">{chat.last_message || (isSaved ? 'پیام‌های ذخیره‌شده شما' : chat.type === 'direct' ? (isOnline ? 'آنلاین' : 'گفت‌وگوی خصوصی') : chat.type === 'group' ? 'گروه' : 'کانال')}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {chat.last_message_time && <span className="text-tg-subtext text-xs">{new Date(chat.last_message_time).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>}
                {(unreadCounts[chat.id] || 0) > 0 && (
                  <span className="bg-tg-accent text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">{unreadCounts[chat.id]}</span>
                )}
              </div>
              {!isSaved && (
                <button onClick={e => { e.stopPropagation(); setMenuChatId(menuChatId === chat.id ? null : chat.id) }} className="w-8 h-8 rounded-full hover:bg-tg-active flex items-center justify-center text-tg-subtext">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>
              )}
              {menuChatId === chat.id && !isSaved && (
                <>
                  <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setMenuChatId(null) }} />
                  <div className="absolute top-full left-2 z-50 bg-tg-panel rounded-xl shadow-2xl border border-tg-hover py-1 animate-scaleIn" onClick={e => e.stopPropagation()}>
                    <button onClick={() => deleteChat(chat.id, isOwner)} className="w-full flex items-center gap-2 px-4 py-2 text-tg-red hover:bg-tg-hover text-sm"><Trash2 size={16} /> {isOwner ? 'حذف گفت‌وگو' : 'ترک گفت‌وگو'}</button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {search.trim() && (filtered.length > 0 || publicResults.length > 0) && (
          <div className="px-3 pt-4 pb-1">
            <p className="text-tg-subtext text-xs font-medium">کانال‌ها و گروه‌های عمومی</p>
          </div>
        )}
        {searchingPublic && publicResults.length === 0 && (
          <p className="text-center text-tg-subtext text-sm p-4">در حال جست‌وجو...</p>
        )}
        {publicResults.map(chat => {
          const title = chat.title || (chat.type === 'channel' ? 'کانال' : 'گروه')
          return (
            <div key={chat.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${selectedId === chat.id ? 'bg-tg-active' : 'hover:bg-tg-hover'}`} onClick={() => onPreviewChat(chat.id)}>
              <Avatar url={chat.avatar_url} name={title} size={48} />
              <div className="flex-1 min-w-0 text-right">
                <p className="text-tg-text font-medium truncate flex items-center gap-1.5">
                  {chat.type === 'channel' ? <Hash size={14} className="text-tg-subtext" /> : <Users size={14} className="text-tg-subtext" />}
                  {title}
                </p>
                <p className="text-tg-subtext text-sm truncate">{chat.type === 'channel' ? 'کانال عمومی' : 'گروه عمومی'}{chat.username ? ` @${chat.username}` : ''}</p>
              </div>
              <span className="text-tg-accent text-xs font-medium bg-tg-accent/10 px-2 py-1 rounded-full">مشاهده</span>
            </div>
          )
        })}
      </div>
      <button onClick={onNewChat} className="absolute bottom-4 left-4 w-14 h-14 rounded-full bg-tg-accent hover:bg-tg-accent2 flex items-center justify-center shadow-lg transition-colors"><Plus size={24} className="text-white" /></button>
      <InstallModal open={showInstall} onClose={() => setShowInstall(false)} />
    </div>
  )
}
