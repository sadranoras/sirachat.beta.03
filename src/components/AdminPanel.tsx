import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Profile, Chat, Message, Report, ChatMember } from '../lib/types'
import { X, Users, MessageSquare, Flag, Shield, Trash2, Ban, Check, Phone, Download, Image as ImageIcon, FileText, Mic, Search, UserCircle, UsersRound, ChevronRight, MessageCircle } from 'lucide-react'
import Avatar from './Avatar'

interface AdminPanelProps { onClose: () => void }
type Tab = 'users' | 'chats' | 'messages' | 'reports'

export default function AdminPanel({ onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<Profile[]>([])
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({})
  const [chats, setChats] = useState<Chat[]>([])
  const [chatMap, setChatMap] = useState<Record<string, Chat>>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [memberships, setMemberships] = useState<Record<string, ChatMember[]>>({})

  const [msgSearch, setMsgSearch] = useState('')
  const [msgFilterChat, setMsgFilterChat] = useState<string>('all')
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [chatSearch, setChatSearch] = useState('')

  const loadUsers = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    const list = (data as Profile[]) || []
    setUsers(list)
    const map: Record<string, Profile> = {}
    for (const p of list) map[p.id] = p
    setProfileMap(map)
  }, [])

  const loadChats = useCallback(async () => {
    const { data } = await supabase.from('chats').select('*').order('created_at', { ascending: false })
    const list = (data as Chat[]) || []
    setChats(list)
    const map: Record<string, Chat> = {}
    for (const c of list) map[c.id] = c
    setChatMap(map)
    const memberMap: Record<string, ChatMember[]> = {}
    const { data: members } = await supabase.from('chat_members').select('*')
    for (const m of (members as ChatMember[]) || []) {
      if (!memberMap[m.chat_id]) memberMap[m.chat_id] = []
      memberMap[m.chat_id].push(m)
    }
    setMemberships(memberMap)
  }, [])

  const loadMessages = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(500)
    setMessages((data as Message[]) || [])
  }, [])

  const loadReports = useCallback(async () => {
    const { data } = await supabase.from('reports').select('*').order('created_at', { ascending: false })
    setReports((data as Report[]) || [])
  }, [])

  useEffect(() => { loadUsers(); loadChats(); loadMessages(); loadReports() }, [loadUsers, loadChats, loadMessages, loadReports])

  const toggleBlockUser = async (u: Profile) => { await supabase.from('profiles').update({ is_blocked: !u.is_blocked }).eq('id', u.id); loadUsers() }
  const toggleAdminUser = async (u: Profile) => { await supabase.from('profiles').update({ is_admin: !u.is_admin }).eq('id', u.id); loadUsers() }
  const deleteChat = async (chatId: string) => { await supabase.from('chat_members').delete().eq('chat_id', chatId); await supabase.from('messages').delete().eq('chat_id', chatId); await supabase.from('chats').delete().eq('id', chatId); loadChats(); loadMessages() }
  const deleteMessage = async (msgId: string) => { await supabase.from('reactions').delete().eq('message_id', msgId); await supabase.from('messages').delete().eq('id', msgId); loadMessages() }
  const resolveReport = async (reportId: string) => { await supabase.from('reports').update({ status: 'resolved' }).eq('id', reportId); loadReports() }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
  }

  const getChatTitle = (chatId: string) => {
    const c = chatMap[chatId]
    if (!c) return 'نامشخص'
    if (c.type === 'direct') {
      const members = memberships[chatId] || []
      const otherIds = members.map(m => m.user_id)
      const other = otherIds.map(id => profileMap[id]).filter(Boolean).map(p => p.display_name || p.username || p.phone || 'ناشناس')
      return other.join(' + ') || 'گفت‌وگوی خصوصی'
    }
    return c.title || (c.type === 'channel' ? 'کانال' : 'گروه')
  }

  const getFileIcon = (m: Message) => {
    if (m.message_type === 'image') return <ImageIcon size={16} className="text-tg-accent" />
    if (m.message_type === 'voice') return <Mic size={16} className="text-tg-accent" />
    return <FileText size={16} className="text-tg-accent" />
  }

  const filteredMessages = messages.filter(m => {
    if (msgFilterChat !== 'all' && m.chat_id !== msgFilterChat) return false
    if (msgSearch.trim()) {
      const sender = profileMap[m.sender_id]
      const senderName = (sender?.display_name || sender?.username || '').toLowerCase()
      const content = (m.content || '').toLowerCase()
      const q = msgSearch.trim().toLowerCase()
      if (!content.includes(q) && !senderName.includes(q)) return false
    }
    return true
  })

  const filteredChats = chats.filter(c => {
    if (!chatSearch.trim()) return true
    const title = (getChatTitle(c.id) + ' ' + (c.title || '') + ' ' + (c.username || '')).toLowerCase()
    return title.includes(chatSearch.trim().toLowerCase())
  })

  const directChatsForUser = (userId: string) => chats.filter(c => c.type === 'direct' && (memberships[c.id] || []).some(m => m.user_id === userId))

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'users', label: 'کاربران', icon: Users },
    { key: 'messages', label: 'پیام‌ها', icon: MessageSquare },
    { key: 'chats', label: 'گفت‌وگوها', icon: MessageCircle },
    { key: 'reports', label: 'گزارش‌ها', icon: Flag },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-tg-panel rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-tg-hover">
          <h2 className="text-lg font-bold text-tg-text flex items-center gap-2"><Shield size={20} className="text-tg-accent" /> پنل مدیریت</h2>
          <button onClick={onClose} className="text-tg-subtext hover:text-tg-text"><X size={20} /></button>
        </div>
        <div className="flex gap-1 p-2 border-b border-tg-hover flex-wrap">
          {tabs.map(t => <button key={t.key} onClick={() => { setTab(t.key); setSelectedChat(null) }} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition-colors ${tab === t.key ? 'bg-tg-active text-white' : 'text-tg-subtext hover:bg-tg-hover'}`}><t.icon size={16} /> {t.label}</button>)}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ---- MESSAGES TAB ---- */}
          {tab === 'messages' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2 sticky top-0 bg-tg-panel pb-2 z-10">
                <div className="relative flex-1">
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-subtext" />
                  <input type="text" placeholder="جستجو در محتوا یا فرستنده..." value={msgSearch} onChange={e => setMsgSearch(e.target.value)} className="w-full bg-tg-hover rounded-xl pr-9 pl-4 py-2 text-sm text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="rtl" />
                </div>
                <select value={msgFilterChat} onChange={e => setMsgFilterChat(e.target.value)} className="bg-tg-hover rounded-xl px-3 py-2 text-sm text-tg-text outline-none">
                  <option value="all">همه گفت‌وگوها</option>
                  {chats.map(c => <option key={c.id} value={c.id}>{getChatTitle(c.id)}</option>)}
                </select>
              </div>
              {filteredMessages.length === 0 && <p className="text-center text-tg-subtext p-8">پیامی یافت نشد</p>}
              {filteredMessages.map(m => {
                const sender = profileMap[m.sender_id]
                const chat = chatMap[m.chat_id]
                return (
                  <div key={m.id} className="flex gap-3 p-3 rounded-xl bg-tg-hover/40 hover:bg-tg-hover transition-colors">
                    <Avatar url={sender?.avatar_url} name={sender?.display_name || sender?.username || ''} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-tg-text text-sm font-medium">{sender?.display_name || sender?.username || 'ناشناس'}</span>
                        <span className="text-tg-subtext text-xs" dir="ltr">{sender?.username ? `@${sender.username}` : ''}</span>
                        <span className="text-tg-subtext text-xs">→</span>
                        <span className="text-tg-accent text-xs font-medium truncate">{getChatTitle(m.chat_id)}</span>
                        <span className="text-tg-subtext text-xs mr-auto" dir="ltr">{formatTime(m.created_at)}</span>
                      </div>
                      <div className="mt-1">
                        {m.message_type === 'text' && <p className="text-tg-text text-sm break-words">{m.content}</p>}
                        {m.message_type === 'image' && (
                          <div className="flex items-center gap-2 mt-1">
                            <img src={m.file_url || ''} alt={m.file_name || ''} className="w-20 h-20 rounded-lg object-cover cursor-pointer" onClick={() => window.open(m.file_url || '', '_blank')} />
                            <a href={m.file_url || ''} download={m.file_name || ''} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-tg-accent text-xs hover:underline"><Download size={14} /> دانلود</a>
                          </div>
                        )}
                        {m.message_type === 'voice' && (
                          <div className="flex items-center gap-2 mt-1">
                            <Mic size={18} className="text-tg-accent" />
                            <span className="text-tg-subtext text-xs">پیام صوتی · {m.duration || 0} ثانیه</span>
                            <a href={m.file_url || ''} download={m.file_name || ''} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-tg-accent text-xs hover:underline mr-2"><Download size={14} /> دانلود</a>
                          </div>
                        )}
                        {m.message_type === 'file' && (
                          <div className="flex items-center gap-2 mt-1">
                            {getFileIcon(m)}
                            <span className="text-tg-text text-sm truncate" dir="ltr">{m.file_name || 'فایل'}</span>
                            {m.file_size && <span className="text-tg-subtext text-xs">({Math.round((m.file_size || 0) / 1024)} کیلوبایت)</span>}
                            <a href={m.file_url || ''} download={m.file_name || ''} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-tg-accent text-xs hover:underline mr-2"><Download size={14} /> دانلود</a>
                          </div>
                        )}
                        {m.content && m.message_type !== 'text' && <p className="text-tg-subtext text-xs mt-1 break-words">{m.content}</p>}
                      </div>
                    </div>
                    <button onClick={() => deleteMessage(m.id)} className="text-tg-red hover:bg-tg-panel p-2 rounded-lg flex-shrink-0 self-start"><Trash2 size={14} /></button>
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- CHATS TAB ---- */}
          {tab === 'chats' && !selectedChat && (
            <div className="space-y-2">
              <div className="relative mb-2">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-subtext" />
                <input type="text" placeholder="جستجوی گفت‌وگو..." value={chatSearch} onChange={e => setChatSearch(e.target.value)} className="w-full bg-tg-hover rounded-xl pr-9 pl-4 py-2 text-sm text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="rtl" />
              </div>
              {filteredChats.map(c => {
                const members = memberships[c.id] || []
                return (
                  <button key={c.id} onClick={() => setSelectedChat(c)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-tg-hover transition-colors text-right">
                    <Avatar url={c.avatar_url} name={getChatTitle(c.id)} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="text-tg-text text-sm font-medium truncate">{getChatTitle(c.id)}</p>
                      <p className="text-tg-subtext text-xs">{c.type === 'direct' ? 'خصوصی' : c.type === 'group' ? 'گروه' : 'کانال'} · {members.length} عضو{c.username ? ` · @${c.username}` : ''}</p>
                    </div>
                    <ChevronRight size={18} className="text-tg-subtext" />
                  </button>
                )
              })}
            </div>
          )}

          {tab === 'chats' && selectedChat && (
            <div className="space-y-3">
              <button onClick={() => setSelectedChat(null)} className="text-tg-subtext hover:text-tg-text flex items-center gap-1 text-sm mb-2">→ بازگشت به لیست</button>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-tg-hover/40">
                <Avatar url={selectedChat.avatar_url} name={getChatTitle(selectedChat.id)} size={56} />
                <div className="flex-1">
                  <p className="text-tg-text font-bold text-lg">{getChatTitle(selectedChat.id)}</p>
                  <p className="text-tg-subtext text-sm">{selectedChat.type === 'direct' ? 'گفت‌وگوی خصوصی' : selectedChat.type === 'group' ? 'گروه' : 'کانال'}{selectedChat.username ? ` · @${selectedChat.username}` : ''}</p>
                  {selectedChat.description && <p className="text-tg-subtext text-xs mt-1">{selectedChat.description}</p>}
                </div>
                <button onClick={() => deleteChat(selectedChat.id)} className="text-tg-red hover:bg-tg-panel p-2 rounded-lg"><Trash2 size={18} /></button>
              </div>

              <div>
                <h3 className="text-tg-text font-bold text-sm mb-2 flex items-center gap-2"><UsersRound size={16} className="text-tg-accent" /> اعضا ({(memberships[selectedChat.id] || []).length})</h3>
                <div className="space-y-1.5">
                  {(memberships[selectedChat.id] || []).map(m => {
                    const p = profileMap[m.user_id]
                    return (
                      <div key={m.user_id} className="flex items-center gap-3 p-2 rounded-xl bg-tg-hover/30">
                        <Avatar url={p?.avatar_url} name={p?.display_name || p?.username || ''} size={32} />
                        <div className="flex-1 min-w-0">
                          <p className="text-tg-text text-sm font-medium truncate">{p?.display_name || p?.username || 'ناشناس'}</p>
                          <p className="text-tg-subtext text-xs" dir="ltr">{p?.username ? `@${p.username}` : p?.phone || ''}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${m.role === 'owner' ? 'bg-tg-accent/20 text-tg-accent' : 'bg-tg-hover text-tg-subtext'}`}>{m.role === 'owner' ? 'مالک' : 'عضو'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-tg-text font-bold text-sm mb-2 flex items-center gap-2"><MessageSquare size={16} className="text-tg-accent" /> پیام‌های این گفت‌وگو</h3>
                <div className="space-y-1.5">
                  {messages.filter(m => m.chat_id === selectedChat.id).slice(0, 50).map(m => {
                    const sender = profileMap[m.sender_id]
                    return (
                      <div key={m.id} className="flex gap-2 p-2 rounded-xl bg-tg-hover/30">
                        <Avatar url={sender?.avatar_url} name={sender?.display_name || sender?.username || ''} size={28} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-tg-text text-xs font-medium">{sender?.display_name || sender?.username || 'ناشناس'}</span>
                            <span className="text-tg-subtext text-xs mr-auto" dir="ltr">{formatTime(m.created_at)}</span>
                          </div>
                          {m.message_type === 'text' && <p className="text-tg-text text-sm break-words">{m.content}</p>}
                          {m.message_type === 'image' && <img src={m.file_url || ''} className="w-16 h-16 rounded-lg object-cover mt-1" onClick={() => window.open(m.file_url || '', '_blank')} />}
                          {(m.message_type === 'file' || m.message_type === 'voice') && (
                            <a href={m.file_url || ''} download={m.file_name || ''} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-tg-accent text-xs hover:underline mt-1"><Download size={12} /> {m.file_name || 'دانلود'}</a>
                          )}
                        </div>
                        <button onClick={() => deleteMessage(m.id)} className="text-tg-red p-1"><Trash2 size={12} /></button>
                      </div>
                    )
                  })}
                  {messages.filter(m => m.chat_id === selectedChat.id).length === 0 && <p className="text-tg-subtext text-sm text-center p-4">پیامی وجود ندارد</p>}
                </div>
              </div>
            </div>
          )}

          {/* ---- USERS TAB ---- */}
          {tab === 'users' && (
            <div className="space-y-2">
              {users.map(u => {
                const dchats = directChatsForUser(u.id)
                return (
                  <div key={u.id} className="p-3 rounded-xl bg-tg-hover/40">
                    <div className="flex items-center gap-3">
                      <Avatar url={u.avatar_url} name={u.display_name || u.username || ''} size={40} />
                      <div className="flex-1 min-w-0">
                        <p className="text-tg-text text-sm font-medium">{u.display_name || u.username || 'بدون نام'} {u.is_owner ? <span className="text-tg-accent text-xs">· مدیر اصلی</span> : u.is_admin ? <span className="text-tg-accent text-xs">· مدیر</span> : null}</p>
                        <p className="text-tg-subtext text-xs" dir="ltr">{u.username ? `@${u.username}` : 'بدون آیدی'} {u.phone && ` · ${u.phone}`}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => toggleAdminUser(u)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${u.is_admin ? 'bg-tg-accent text-white' : 'bg-tg-hover text-tg-subtext hover:bg-tg-active/60'}`}><Shield size={14} /> {u.is_admin ? 'مدیر' : 'تبدیل به مدیر'}</button>
                        {u.is_admin
                          ? (u.is_owner
                            ? <span className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-tg-accent/20 text-tg-accent cursor-default"><Shield size={14} /> مدیر اصلی</span>
                            : <button onClick={() => toggleAdminUser(u)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-tg-hover text-tg-subtext hover:bg-tg-active/60 transition-colors"><Shield size={14} /> لغو مدیر</button>)
                          : <button onClick={() => toggleBlockUser(u)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${u.is_blocked ? 'bg-tg-green text-white' : 'bg-tg-red text-white'}`}>{u.is_blocked ? <><Check size={14} /> رفع مسدودیت</> : <><Ban size={14} /> مسدود</>}</button>}
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-tg-border/50 flex items-center gap-4 text-xs">
                      <span className="text-tg-subtext flex items-center gap-1"><UserCircle size={14} /> {dchats.length} گفت‌وگوی خصوصی</span>
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {dchats.slice(0, 5).map(dc => {
                          const otherId = (memberships[dc.id] || []).find(m => m.user_id !== u.id)?.user_id
                          const other = otherId ? profileMap[otherId] : null
                          return <span key={dc.id} className="text-tg-subtext bg-tg-hover px-2 py-0.5 rounded-full">{other?.display_name || other?.username || 'ناشناس'}</span>
                        })}
                        {dchats.length > 5 && <span className="text-tg-subtext">+{dchats.length - 5}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ---- REPORTS TAB ---- */}
          {tab === 'reports' && (
            <div className="space-y-2">
              {reports.length === 0 && <p className="text-center text-tg-subtext p-8">گزارشی وجود ندارد</p>}
              {reports.map(r => {
                const reporter = profileMap[r.reporter_id]
                const reported = profileMap[r.reported_id]
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-tg-hover/40">
                    <div className="w-9 h-9 rounded-full bg-tg-red flex items-center justify-center text-white flex-shrink-0"><Flag size={16} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-tg-text text-sm"><span className="font-medium">{reporter?.display_name || reporter?.username || 'ناشناس'}</span> گزارش داد: <span className="text-tg-subtext">{reported?.display_name || reported?.username || 'ناشناس'}</span></p>
                      <p className="text-tg-subtext text-xs mt-0.5">{r.reason}{r.description ? ` · ${r.description}` : ''}</p>
                      <p className="text-tg-subtext text-xs mt-0.5">وضعیت: {r.status === 'resolved' ? 'حل شده' : 'در انتظار'} · {formatTime(r.created_at)}</p>
                    </div>
                    {r.status !== 'resolved' && <button onClick={() => resolveReport(r.id)} className="text-tg-green hover:bg-tg-panel p-2 rounded-lg flex-shrink-0"><Check size={16} /></button>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
