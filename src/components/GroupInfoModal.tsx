import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Chat, Profile, ChatMember, Message } from '../lib/types'
import { X, Users, Plus, Trash2, Crown, UserPlus, Info, Image as ImageIcon, Mic, FileText, Play, Download, Megaphone, Camera, Link2, Copy, Check, Eye, EyeOff, AtSign, Search, Loader2, ShieldCheck, ShieldOff, Video as VideoIcon } from 'lucide-react'
import Avatar from './Avatar'
import { isVideoFile } from '../lib/videoUtils'
import MediaViewer, { MediaItem } from './MediaViewer'

interface GroupInfoModalProps { chat: Chat; onClose: () => void; onChatUpdated?: () => void }

type Tab = 'info' | 'photos' | 'videos' | 'voice' | 'files'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatMediaDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function genToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 18)
}

export default function GroupInfoModal({ chat, onClose, onChatUpdated }: GroupInfoModalProps) {
  const { user } = useAuth()
  const isChannel = chat.type === 'channel'
  const [members, setMembers] = useState<ChatMember[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [mediaMessages, setMediaMessages] = useState<Message[]>([])
  const [loadingMedia, setLoadingMedia] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [playingVoice, setPlayingVoice] = useState<string | null>(null)
  const [videoViewer, setVideoViewer] = useState<{ items: MediaItem[]; index: number } | null>(null)

  const [editTitle, setEditTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(chat.title || '')
  const [editDesc, setEditDesc] = useState(false)
  const [descValue, setDescValue] = useState(chat.description || '')
  const [editUsername, setEditUsername] = useState(false)
  const [usernameValue, setUsernameValue] = useState(chat.username || '')
  const [usernameError, setUsernameError] = useState('')
  const [usernameChecking, setUsernameChecking] = useState(false)

  const [avatarUrl, setAvatarUrl] = useState(chat.avatar_url)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isPrivate, setIsPrivate] = useState(chat.is_private || false)
  const [inviteToken, setInviteToken] = useState(chat.invite_token || '')
  const [copied, setCopied] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState(false)

  const loadMembers = useCallback(async () => {
    const { data: membersData } = await supabase.from('chat_members').select('*').eq('chat_id', chat.id)
    if (!membersData) return
    setMembers(membersData as ChatMember[])
    const userIds = (membersData as any[]).map(m => m.user_id)
    if (userIds.length === 0) return
    const { data: profilesData } = await supabase.from('profiles').select('*').in('id', userIds)
    const map: Record<string, Profile> = {}
    for (const p of (profilesData || []) as Profile[]) map[p.id] = p
    setProfiles(map)
  }, [chat.id])

  useEffect(() => { loadMembers() }, [loadMembers])

  const loadMedia = async () => {
    setLoadingMedia(true)
    const { data: msgs } = await supabase.from('messages')
      .select('*')
      .eq('chat_id', chat.id)
      .in('message_type', ['image', 'voice', 'file'])
      .not('file_url', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
    setMediaMessages((msgs || []) as Message[])
    setLoadingMedia(false)
  }

  useEffect(() => {
    if (activeTab !== 'info' && mediaMessages.length === 0 && !loadingMedia) {
      loadMedia()
    }
  }, [activeTab])

  const photos = useMemo(() => mediaMessages.filter(m => m.message_type === 'image'), [mediaMessages])
  const videoMsgs = useMemo(() => mediaMessages.filter(m => m.message_type === 'file' && isVideoFile(m.file_name)), [mediaMessages])
  const voiceMsgs = useMemo(() => mediaMessages.filter(m => m.message_type === 'voice'), [mediaMessages])
  const fileMsgs = useMemo(() => mediaMessages.filter(m => m.message_type === 'file' && !isVideoFile(m.file_name)), [mediaMessages])

  const searchUsers = async (query: string) => {
    setSearch(query)
    if (query.trim().length < 1) { setSearchResults([]); return }
    const memberIds = members.map(m => m.user_id)
    // Find users I have direct chats with, filtered by query
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
      let contacts: Profile[] = []
      if (directPeerIds.length > 0) {
        const { data: contactProfiles } = await supabase.from('profiles').select('*').in('id', directPeerIds).or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        contacts = (contactProfiles as Profile[]) || []
      }
      // Also search all users by username/display_name
      const { data: allMatches } = await supabase.from('profiles').select('*').or(`username.ilike.%${query}%,display_name.ilike.%${query}%`).not('id', 'in', `(${memberIds.join(',') || '00000000-0000-0000-0000-000000000000'})`).limit(20)
      const allMap = new Map<string, Profile>()
      for (const p of contacts) allMap.set(p.id, p)
      for (const p of (allMatches as Profile[]) || []) allMap.set(p.id, p)
      setSearchResults([...allMap.values()].slice(0, 20))
    } else {
      const { data } = await supabase.from('profiles').select('*').or(`username.ilike.%${query}%,display_name.ilike.%${query}%`).not('id', 'in', `(${memberIds.join(',') || '00000000-0000-0000-0000-000000000000'})`).limit(20)
      setSearchResults((data as Profile[]) || [])
    }
  }

  const addMember = async (p: Profile) => {
    await supabase.from('chat_members').insert({ chat_id: chat.id, user_id: p.id, role: 'member' })
    setShowAdd(false); setSearch(''); setSearchResults([])
    loadMembers()
  }

  const removeMember = async (memberUserId: string) => {
    await supabase.from('chat_members').delete().eq('chat_id', chat.id).eq('user_id', memberUserId)
    loadMembers()
  }

  const setMemberRole = async (memberUserId: string, role: 'admin' | 'member') => {
    await supabase.from('chat_members').update({ role }).eq('chat_id', chat.id).eq('user_id', memberUserId)
    loadMembers()
  }

  const saveTitle = async () => {
    if (!titleValue.trim()) return
    await supabase.from('chats').update({ title: titleValue.trim() }).eq('id', chat.id)
    chat.title = titleValue.trim()
    setEditTitle(false)
    onChatUpdated?.()
  }

  const saveDesc = async () => {
    await supabase.from('chats').update({ description: descValue.trim() || null }).eq('id', chat.id)
    chat.description = descValue.trim() || null
    setEditDesc(false)
    onChatUpdated?.()
  }

  const checkUsername = async (value: string): Promise<string> => {
    const clean = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (clean.length < 3) return 'نام کاربری حداقل ۳ حرف باید باشد'
    if (clean.length > 32) return 'نام کاربری حداکثر ۳۲ حرف'
    if (!/^[a-z0-9_]+$/.test(clean)) return 'فقط حروف انگلیسی، اعداد و زیرخط'
    const { data } = await supabase.from('chats').select('id').eq('username', clean).neq('id', chat.id).maybeSingle()
    if (data) return 'این نام کاربری قبلاً گرفته شده'
    return ''
  }

  const saveUsername = async () => {
    const clean = usernameValue.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!clean) {
      // clearing username
      await supabase.from('chats').update({ username: null }).eq('id', chat.id)
      chat.username = null
      setUsernameValue('')
      setEditUsername(false)
      onChatUpdated?.()
      return
    }
    setUsernameChecking(true)
    const err = await checkUsername(clean)
    setUsernameChecking(false)
    if (err) { setUsernameError(err); return }
    await supabase.from('chats').update({ username: clean }).eq('id', chat.id)
    chat.username = clean
    setUsernameValue(clean)
    setUsernameError('')
    setEditUsername(false)
    onChatUpdated?.()
  }

  const uploadAvatar = async (file: File) => {
    setUploadingAvatar(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `chat-avatars/${chat.id}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = pub.publicUrl
      await supabase.from('chats').update({ avatar_url: url }).eq('id', chat.id)
      setAvatarUrl(url)
      chat.avatar_url = url
      onChatUpdated?.()
    } catch (e) {
      // ignore
    }
    setUploadingAvatar(false)
  }

  const togglePrivacy = async () => {
    setSavingPrivacy(true)
    const newVal = !isPrivate
    await supabase.from('chats').update({ is_private: newVal }).eq('id', chat.id)
    setIsPrivate(newVal)
    chat.is_private = newVal
    setSavingPrivacy(false)
    onChatUpdated?.()
  }

  const generateLink = async () => {
    const token = genToken()
    await supabase.from('chats').update({ invite_token: token }).eq('id', chat.id)
    setInviteToken(token)
    chat.invite_token = token
  }

  const inviteUrl = inviteToken ? `${window.location.origin}?join=${inviteToken}` : ''

  const copyLink = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const myRole = members.find(m => m.user_id === user?.id)?.role
  const isOwner = myRole === 'owner' || myRole === 'admin'
  // In channels, only admins/owner can see the full member list.
  // Regular members only see themselves.
  const canViewMembers = isOwner || !isChannel
  const labelType = isChannel ? 'کانال' : 'گروه'
  const labelMembers = isChannel ? 'مشترک' : 'عضو'

  const tabs: { key: Tab; label: string; icon: typeof ImageIcon; count: number }[] = [
    { key: 'info', label: 'اطلاعات', icon: Info, count: -1 },
    { key: 'photos', label: 'عکس', icon: ImageIcon, count: photos.length },
    { key: 'videos', label: 'ویدئو', icon: VideoIcon, count: videoMsgs.length },
    { key: 'voice', label: 'ویس', icon: Mic, count: voiceMsgs.length },
    { key: 'files', label: 'فایل', icon: FileText, count: fileMsgs.length },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-tg-panel rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto animate-slideUp shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header banner */}
        <div className="relative bg-gradient-to-b from-tg-active to-tg-panel pb-4">
          <button onClick={onClose} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white transition-colors">
            <X size={20} />
          </button>
          <div className="flex flex-col items-center pt-8 px-6">
            {/* Avatar with upload */}
            <div className="relative group">
              <Avatar url={avatarUrl} name={chat.title || labelType} size={110} />
              {isOwner && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-1 left-1 w-8 h-8 rounded-full bg-tg-accent hover:bg-tg-accent2 flex items-center justify-center shadow-lg transition-colors"
                  title="تغییر عکس"
                >
                  {uploadingAvatar ? <Loader2 size={16} className="text-white animate-spin" /> : <Camera size={16} className="text-white" />}
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f) }} />
            </div>
            {isOwner ? (
              editTitle ? (
                <div className="flex items-center gap-2 mt-4">
                  <input autoFocus value={titleValue} onChange={e => setTitleValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveTitle()} className="bg-black/20 rounded-lg px-3 py-1 text-xl font-bold text-white outline-none text-center" />
                  <button onClick={saveTitle} className="text-tg-green text-sm">ذخیره</button>
                  <button onClick={() => { setEditTitle(false); setTitleValue(chat.title || '') }} className="text-white/60 text-sm">انصراف</button>
                </div>
              ) : (
                <h2 className="text-xl font-bold text-white mt-4 cursor-pointer hover:text-tg-accent" onClick={() => { setTitleValue(chat.title || ''); setEditTitle(true) }}>{chat.title || labelType}</h2>
              )
            ) : (
              <h2 className="text-xl font-bold text-white mt-4">{chat.title || labelType}</h2>
            )}
            <p className="text-white/60 text-sm mt-1 flex items-center gap-1">
              {isChannel ? <Megaphone size={14} /> : <Users size={14} />}
              {canViewMembers ? `${members.length} ${labelMembers}` : labelMembers}
            </p>
            {isOwner ? (
              editDesc ? (
                <div className="mt-2 w-full max-w-xs">
                  <textarea autoFocus value={descValue} onChange={e => setDescValue(e.target.value)} className="w-full bg-black/20 rounded-lg px-3 py-1.5 text-white text-sm outline-none text-center resize-none" rows={2} />
                  <div className="flex justify-center gap-3 mt-1">
                    <button onClick={saveDesc} className="text-tg-green text-xs">ذخیره</button>
                    <button onClick={() => { setEditDesc(false); setDescValue(chat.description || '') }} className="text-white/60 text-xs">انصراف</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => { setDescValue(chat.description || ''); setEditDesc(true) }} className="text-white/50 text-sm mt-1 text-center hover:text-white/80 transition-colors">
                  {chat.description || (isChannel ? 'توضیحات کانال را اضافه کنید' : 'توضیحات گروه را اضافه کنید')}
                </button>
              )
            ) : chat.description && (
              <p className="text-white/50 text-sm mt-1 text-center">{chat.description}</p>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-tg-hover bg-tg-panel sticky top-0 z-10">
          {tabs.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors relative ${isActive ? 'text-tg-accent' : 'text-tg-subtext hover:text-tg-text'}`}>
                <Icon size={20} />
                <span className="text-xs">{tab.label}</span>
                {tab.count >= 0 && tab.count > 0 && <span className="text-[10px] text-tg-subtext">{tab.count}</span>}
                {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-tg-accent" />}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'info' ? (
          <>
            {/* Username / public link */}
            {isOwner && (
              <div className="px-4 py-3 border-b border-tg-hover">
                <p className="text-tg-subtext text-xs mb-2 flex items-center gap-1"><AtSign size={14} /> نام کاربری عمومی</p>
                {editUsername ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-tg-subtext">@</span>
                      <input autoFocus value={usernameValue} onChange={e => { setUsernameValue(e.target.value); setUsernameError('') }} onKeyDown={e => e.key === 'Enter' && saveUsername()} placeholder="username" className="flex-1 bg-tg-hover rounded-lg px-3 py-2 text-tg-text outline-none text-sm" />
                      <button onClick={saveUsername} disabled={usernameChecking} className="text-tg-green text-sm flex items-center gap-1">
                        {usernameChecking ? <Loader2 size={14} className="animate-spin" /> : 'ذخیره'}
                      </button>
                      <button onClick={() => { setEditUsername(false); setUsernameValue(chat.username || ''); setUsernameError('') }} className="text-tg-subtext text-sm">انصراف</button>
                    </div>
                    {usernameError && <p className="text-tg-red text-xs mt-1">{usernameError}</p>}
                    <p className="text-tg-subtext text-[11px] mt-1">حداقل ۳ حرف، فقط انگلیسی، عدد و زیرخط</p>
                  </div>
                ) : (
                  <button onClick={() => { setUsernameValue(chat.username || ''); setEditUsername(true) }} className="w-full flex items-center justify-between bg-tg-hover rounded-lg px-3 py-2 hover:bg-tg-hover/80 transition-colors">
                    <span className={chat.username ? 'text-tg-text text-sm' : 'text-tg-subtext text-sm'}>{chat.username ? `@${chat.username}` : 'بدون نام کاربری'}</span>
                    <span className="text-tg-accent text-xs">ویرایش</span>
                  </button>
                )}
              </div>
            )}
            {!isOwner && chat.username && (
              <div className="px-4 py-3 border-b border-tg-hover">
                <p className="text-tg-subtext text-xs mb-1 flex items-center gap-1"><AtSign size={14} /> نام کاربری</p>
                <p className="text-tg-text text-sm">@{chat.username}</p>
              </div>
            )}

            {/* Privacy + invite link */}
            {isOwner && (
              <div className="px-4 py-3 border-b border-tg-hover">
                {/* Privacy toggle */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-tg-text text-sm flex items-center gap-1.5">
                      {isPrivate ? <EyeOff size={16} className="text-tg-subtext" /> : <Eye size={16} className="text-tg-subtext" />}
                      {labelType} خصوصی
                    </p>
                    <p className="text-tg-subtext text-[11px] mt-0.5">{isPrivate ? 'در جستجو نمایش داده نمی‌شود' : 'برای همه قابل مشاهده'}</p>
                  </div>
                  <button
                    onClick={togglePrivacy}
                    disabled={savingPrivacy}
                    className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${isPrivate ? 'bg-tg-accent' : 'bg-tg-hover'}`}
                  >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${isPrivate ? 'left-0.5' : 'left-[22px]'}`} />
                  </button>
                </div>

                {/* Invite link */}
                <div>
                  <p className="text-tg-subtext text-xs mb-2 flex items-center gap-1"><Link2 size={14} /> لینک دعوت</p>
                  {inviteToken ? (
                    <div className="bg-tg-hover rounded-lg p-2.5">
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-tg-text text-xs truncate font-mono" dir="ltr">{inviteUrl}</p>
                        <button onClick={copyLink} className="text-tg-accent p-1 rounded hover:bg-tg-active/50 transition-colors">
                          {copied ? <Check size={16} className="text-tg-green" /> : <Copy size={16} />}
                        </button>
                      </div>
                      <button onClick={generateLink} className="text-tg-subtext text-[11px] mt-1.5 hover:text-tg-text transition-colors">تولید لینک جدید</button>
                    </div>
                  ) : (
                    <button onClick={generateLink} className="w-full flex items-center justify-center gap-2 bg-tg-hover hover:bg-tg-hover/80 rounded-lg py-2 text-tg-accent text-sm transition-colors">
                      <Link2 size={16} /> ایجاد لینک دعوت
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Members list — hidden for non-admin channel subscribers */}
            {canViewMembers ? (
              <>
                <div className="px-3 pt-3 pb-2">
                  <p className="text-tg-subtext text-xs px-3 mb-1">{members.length} {labelMembers}</p>
                </div>
                <div className="px-2 pb-2 max-h-[35vh] overflow-y-auto">
                  {members.map(m => {
                    const p = profiles[m.user_id]
                    if (!p) return null
                    return (
                      <div key={m.user_id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-tg-hover transition-colors">
                        <div className="relative">
                          <Avatar url={p.avatar_url} name={p.display_name || p.username || ''} size={40} />
                          <div className={`absolute bottom-0 left-0 w-2.5 h-2.5 rounded-full border border-tg-panel ${p.is_online ? 'bg-tg-green' : 'bg-tg-subtext'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-tg-text text-sm font-medium truncate">{p.display_name || p.username || 'بدون نام'}</p>
                          <p className="text-tg-subtext text-xs">{p.username ? `@${p.username}` : 'بدون آیدی'}</p>
                        </div>
                        {m.role === 'owner' && <Crown size={16} className="text-tg-yellow flex-shrink-0" />}
                        {m.role === 'admin' && <ShieldCheck size={16} className="text-tg-accent flex-shrink-0" />}
                        {isOwner && m.user_id !== user?.id && m.role !== 'owner' && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {m.role === 'member' ? (
                              <button onClick={() => setMemberRole(m.user_id, 'admin')} className="text-tg-accent hover:bg-tg-accent/10 p-1.5 rounded-lg" title="ارتقا به مدیر"><ShieldCheck size={14} /></button>
                            ) : (
                              <button onClick={() => setMemberRole(m.user_id, 'member')} className="text-tg-subtext hover:bg-tg-hover p-1.5 rounded-lg" title="تنزیل به عضو"><ShieldOff size={14} /></button>
                            )}
                            <button onClick={() => removeMember(m.user_id)} className="text-tg-red hover:bg-tg-red/10 p-1.5 rounded-lg"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="px-4 py-6 text-center">
                <EyeOff size={28} className="text-tg-subtext mx-auto mb-2 opacity-50" />
                <p className="text-tg-subtext text-sm">فقط مدیران کانال می‌توانند لیست اعضا را مشاهده کنند</p>
              </div>
            )}

            {/* Add member */}
            {isOwner && (
              <div className="p-3 border-t border-tg-hover">
                {!showAdd ? (
                  <button onClick={() => setShowAdd(true)} className="w-full flex items-center justify-center gap-2 text-tg-accent hover:bg-tg-hover rounded-xl py-2.5 text-sm transition-colors">
                    <UserPlus size={18} /> {isChannel ? 'افزودن مشترک' : 'افزودن عضو'}
                  </button>
                ) : (
                  <div>
                    <div className="relative mb-2">
                      <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-tg-subtext" />
                      <input type="text" placeholder="جستجوی کاربر..." value={search} onChange={e => searchUsers(e.target.value)} className="w-full bg-tg-hover rounded-xl pr-9 pl-4 py-2.5 text-tg-text placeholder-tg-subtext outline-none text-sm" autoFocus />
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {searchResults.map(u => (
                        <button key={u.id} onClick={() => addMember(u)} className="w-full flex items-center gap-2 p-2 hover:bg-tg-hover rounded-lg text-right transition-colors">
                          <Avatar url={u.avatar_url} name={u.display_name || u.username || ''} size={32} />
                          <span className="text-tg-text text-sm flex-1 truncate">{u.display_name || u.username || 'بدون نام'}</span>
                          <Plus size={16} className="text-tg-accent" />
                        </button>
                      ))}
                    </div>
                    <button onClick={() => { setShowAdd(false); setSearch(''); setSearchResults([]) }} className="w-full text-tg-subtext text-sm mt-2 py-1.5">انصراف</button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* Shared media tabs */
          <div className="min-h-[300px]">
            {loadingMedia ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-tg-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : activeTab === 'photos' ? (
              photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-tg-subtext">
                  <ImageIcon size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">عکسی وجود ندارد</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-0.5 p-0.5">
                  {photos.map(msg => (
                    <button key={msg.id} onClick={() => setLightbox(msg.file_url)} className="aspect-square overflow-hidden bg-tg-hover group relative">
                      <img src={msg.file_url!} alt={msg.file_name || ''} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </button>
                  ))}
                </div>
              )
            ) : activeTab === 'videos' ? (
              videoMsgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-tg-subtext">
                  <VideoIcon size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">ویدئویی وجود ندارد</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-0.5 p-0.5">
                  {videoMsgs.map((msg, i) => (
                    <button key={msg.id} onClick={() => setVideoViewer({ items: videoMsgs.map(m => ({ url: m.file_url!, type: 'video' as const, name: m.file_name || '' })), index: i })} className="aspect-square overflow-hidden bg-tg-hover group relative">
                      <video src={msg.file_url!} className="w-full h-full object-cover" preload="metadata" muted />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center opacity-80">
                            <Play size={18} className="text-white" fill="white" />
                          </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : activeTab === 'voice' ? (
              voiceMsgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-tg-subtext">
                  <Mic size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">ویسی وجود ندارد</p>
                </div>
              ) : (
                <div className="divide-y divide-tg-hover">
                  {voiceMsgs.map(msg => (
                    <div key={msg.id} className="flex items-center gap-3 px-4 py-3 hover:bg-tg-hover transition-colors">
                      <button onClick={() => setPlayingVoice(playingVoice === msg.id ? null : msg.id)} className="w-10 h-10 rounded-full bg-tg-accent flex items-center justify-center flex-shrink-0 hover:bg-tg-accent2 transition-colors">
                        <Play size={18} className="text-white" fill="white" />
                      </button>
                      <div className="flex-1 min-w-0">
                        {playingVoice === msg.id ? (
                          <audio controls autoPlay src={msg.file_url!} className="h-8 w-full" onEnded={() => setPlayingVoice(null)} />
                        ) : (
                          <>
                            <p className="text-tg-text text-sm">پیام صوتی</p>
                            <p className="text-tg-subtext text-xs">{msg.duration ? formatDuration(msg.duration) : ''} · {formatMediaDate(msg.created_at)}</p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : activeTab === 'files' ? (
              fileMsgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-tg-subtext">
                  <FileText size={40} className="mb-3 opacity-40" />
                  <p className="text-sm">فایلی وجود ندارد</p>
                </div>
              ) : (
                <div className="divide-y divide-tg-hover">
                  {fileMsgs.map(msg => (
                    <a key={msg.id} href={msg.file_url!} download={msg.file_name || undefined} className="flex items-center gap-3 px-4 py-3 hover:bg-tg-hover transition-colors group">
                      <div className="w-10 h-10 rounded-xl bg-tg-hover flex items-center justify-center flex-shrink-0">
                        <FileText size={20} className="text-tg-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-tg-text text-sm truncate">{msg.file_name}</p>
                        <p className="text-tg-subtext text-xs">{msg.file_size ? formatFileSize(msg.file_size) : ''} · {formatMediaDate(msg.created_at)}</p>
                      </div>
                      <Download size={18} className="text-tg-subtext group-hover:text-tg-accent transition-colors flex-shrink-0" />
                    </a>
                  ))}
                </div>
              )
            ) : null}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors">
            <X size={24} />
          </button>
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
      {videoViewer && (
        <MediaViewer items={videoViewer.items} startIndex={videoViewer.index} onClose={() => setVideoViewer(null)} />
      )}
    </div>
  )
}
