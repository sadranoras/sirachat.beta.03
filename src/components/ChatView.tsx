import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Chat, Profile, Message, Reaction, Call, ReadReceipt } from '../lib/types'
import { Send, Phone, Video, Paperclip, Smile, ArrowRight, Trash2, Reply, MoreVertical, Check, CheckCheck, X, Image as ImageIcon, FileText, Mic, Play, Pencil, Download, Loader2, Megaphone, Plus, FileVideo, PlayCircle, Users, Bookmark, Forward, Copy, Eye } from 'lucide-react'
import { sendPushNotification } from '../lib/push'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function uploadWithProgress(bucket: string, path: string, body: Blob, onProgress: (pct: number) => void): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || supabaseAnonKey
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve(path)
      } else {
        let msg = `Upload failed: ${xhr.status}`
        try { const res = JSON.parse(xhr.responseText); if (res.message) msg = res.message } catch {}
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream')
    xhr.send(body)
  })
}

async function downloadWithProgress(url: string, fileName: string, onProgress: (pct: number) => void): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Download failed')
  const contentType = res.headers.get('content-type') || guessMime(fileName) || 'application/octet-stream'
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body?.getReader()
  if (!reader || !total) { const b = await res.blob(); onProgress(100); return new Blob([b], { type: contentType }) }
  const chunks: BlobPart[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) { chunks.push(value); received += value.length; onProgress(Math.round((received / total) * 100)) }
  }
  return new Blob(chunks, { type: contentType })
}
import Avatar from './Avatar'
import ReactionPicker from './ReactionPicker'
import FileCaptionModal from './FileCaptionModal'
import ForwardModal from './ForwardModal'
import GroupInfoModal from './GroupInfoModal'
import ProfileModal from './ProfileModal'
import VoicePlayer from './VoicePlayer'
import MediaViewer, { MediaItem } from './MediaViewer'
import { subscribeUploads, startFileUpload, getUploadsForChat, ActiveUpload } from '../lib/uploads'
import { getCachedFile, setCachedFile, openBlob, guessMime, formatDayDivider } from '../lib/fileCache'
import { formatMessageTime } from '../lib/format'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv', '3gp']
function isVideoFile(name: string | null): boolean {
  if (!name) return false
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return VIDEO_EXTENSIONS.includes(ext)
}
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function linkify(text: string, onMention?: (username: string) => void, onPhoneMention?: (phone: string) => void): React.ReactNode {
  const combined = /(?<url>https?:\/\/[^\s]+|[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)|(?<mention>@[a-z0-9_]{3,32})|(?<phone>(?:\+?98|0)?9\d{9})/gi
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  for (const match of text.matchAll(combined)) {
    const start = match.index ?? 0
    if (start > lastIndex) nodes.push(<span key={key++}>{text.slice(lastIndex, start)}</span>)
    const m = match[0]
    if (match.groups?.url) {
      // In-app invite link: stay inside the app instead of opening a new tab
      const joinMatch = m.match(/[?&]join=([a-zA-Z0-9]+)/)
      if (joinMatch) {
        nodes.push(<button key={key++} onClick={() => window.dispatchEvent(new CustomEvent('app-join-invite', { detail: joinMatch[1] }))} className="text-tg-accent hover:underline break-all inline">{m}</button>)
      } else {
        const href = m.startsWith('http') ? m : `https://${m}`
        nodes.push(<a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-tg-accent hover:underline break-all">{m}</a>)
      }
    } else if (match.groups?.mention && onMention) {
      const uname = m.slice(1)
      nodes.push(<button key={key++} onClick={() => onMention(uname)} className="text-tg-accent hover:underline inline">{m}</button>)
    } else if (match.groups?.phone && onPhoneMention) {
      nodes.push(<button key={key++} onClick={() => onPhoneMention(m)} className="text-tg-accent hover:underline inline">{m}</button>)
    } else {
      nodes.push(<span key={key++}>{m}</span>)
    }
    lastIndex = start + m.length
  }
  if (lastIndex < text.length) nodes.push(<span key={key++}>{text.slice(lastIndex)}</span>)
  return nodes
}

interface ChatViewProps { chatId: string; onBack: () => void; onCall?: (callId: string) => void; onShowProfile: (userId: string) => void; onOpenChatWithUsername?: (username: string) => void; onOpenChatWithPhone?: (phone: string) => void; previewMode?: boolean; previewPrivate?: boolean; onJoined?: (id: string) => void }

export default function ChatView({ chatId, onBack, onCall, onShowProfile, onOpenChatWithUsername, onOpenChatWithPhone, previewMode, previewPrivate, onJoined }: ChatViewProps) {
  const { user, profile } = useAuth()
  const [chat, setChat] = useState<Chat | null>(null)
  const [otherUser, setOtherUser] = useState<Profile | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAttach, setShowAttach] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [menuMsgId, setMenuMsgId] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null)
  const [reactionPos, setReactionPos] = useState<{ top: number; left: number } | null>(null)

  const computeMenuPos = (e: React.MouseEvent, menuHeight = 160, menuWidth = 160) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow < menuHeight + 20 ? rect.top - menuHeight - 4 : rect.bottom + 4
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 8)
    const clampedTop = Math.min(top, window.innerHeight - menuHeight - 8)
    return { top: Math.max(8, clampedTop), left: Math.max(8, left) }
  }
  const [showFileModal, setShowFileModal] = useState<{ type: 'image' | 'file'; file: File } | null>(null)
  const [mediaViewer, setMediaViewer] = useState<{ items: MediaItem[]; index: number } | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [showGroupInfo, setShowGroupInfo] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [isMember, setIsMember] = useState(!previewMode)
  const [joining, setJoining] = useState(false)
  const [myRole, setMyRole] = useState<string | null>(null)
  const [otherOnline, setOtherOnline] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const lastTypingAtRef = useRef<number>(0)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingPingRef = useRef<number>(0)
  const [recording, setRecording] = useState(false)
  const [recordDuration, setRecordDuration] = useState(0)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
  const [pendingUploads, setPendingUploads] = useState<ActiveUpload[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const cancelRecordingRef = useRef(false)
  const audioChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const markedReadRef = useRef<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null)
  const [seenByMsg, setSeenByMsg] = useState<Message | null>(null)
  const [seenByProfiles, setSeenByProfiles] = useState<Record<string, Profile>>({})
  const seenByPosRef = useRef<{ top: number; left: number } | null>(null)
  const scrollToMessage = useCallback((msgId: string) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMsgId(msgId)
    setTimeout(() => setHighlightedMsgId(null), 2000)
  }, [])

  const loadChat = useCallback(async () => {
    if (!user) return
    const { data: chatData } = await supabase.from('chats').select('*').eq('id', chatId).single()
    if (!chatData) return
    setChat(chatData as Chat)
    const { data: members } = await supabase.from('chat_members').select('user_id, role').eq('chat_id', chatId)
    if (!members) return
    const myMember = (members as any[]).find(m => m.user_id === user.id)
    if (myMember) { setMyRole(myMember.role); setIsMember(true) }
    const otherMember = (members as any[]).find(m => m.user_id !== user.id)
    if (otherMember) {
      const { data: otherProfile } = await supabase.from('profiles').select('*').eq('id', otherMember.user_id).single()
      if (otherProfile) { setOtherUser(otherProfile as Profile); setOtherOnline((otherProfile as Profile).is_online || false) }
    }
  }, [chatId, user])

  const loadMessages = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        sender:profiles!messages_sender_id_profiles_fkey(*),
        reactions(*)
      `)
      .eq('chat_id', chatId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) { setLoading(false); return }
    const msgs = ((data || []) as unknown as Message[]).reverse()
    // Fetch read receipts for these messages
    const msgIds = msgs.map(m => m.id).filter(id => !id.startsWith('temp-'))
    let receiptsByMsg: Record<string, ReadReceipt[]> = {}
    if (msgIds.length > 0) {
      const { data: receipts, error: rErr } = await supabase
        .from('message_read_receipts')
        .select('message_id, user_id, read_at')
        .in('message_id', msgIds)
      if (!rErr && receipts) {
        for (const r of receipts as ReadReceipt[]) {
          if (!receiptsByMsg[r.message_id]) receiptsByMsg[r.message_id] = []
          receiptsByMsg[r.message_id].push(r)
        }
      }
    }
    const withReceipts = msgs.map(m => ({ ...m, read_receipts: receiptsByMsg[m.id] || [] }))
    const activeUploads = getUploadsForChat(chatId).filter(u => u.status !== 'done' && u.message) as { message: Message }[]
    const uploadMsgs = activeUploads.map(u => u.message)
    const existingIds = new Set(withReceipts.map(m => m.id))
    const merged = [...withReceipts, ...uploadMsgs.filter(m => !existingIds.has(m.id))]
    setMessages(merged)
    setLoading(false)
    setTimeout(scrollToBottom, 100)
  }, [chatId, user, scrollToBottom])

  useEffect(() => { markedReadRef.current = new Set() }, [chatId])

  useEffect(() => { loadChat(); loadMessages() }, [loadChat, loadMessages])

  useEffect(() => {
    if (!scrollContainerRef.current || messages.length === 0) return
    const root = scrollContainerRef.current
    const observer = new IntersectionObserver((entries) => {
      const visibleUnread = entries.filter(e => e.isIntersecting)
      if (visibleUnread.length === 0) return
      const now = new Date().toISOString()
      const toMark: string[] = []
      visibleUnread.forEach(entry => {
        const id = (entry.target as HTMLElement).dataset.msgId
        if (!id) return
        const msg = messagesRef.current.find(m => m.id === id)
        const alreadyHasReceipt = (msg?.read_receipts || []).some(r => r.user_id === user?.id)
        if (msg && msg.sender_id !== user?.id && !markedReadRef.current.has(id) && !alreadyHasReceipt) {
          markedReadRef.current.add(id)
          toMark.push(id)
        }
      })
      if (toMark.length > 0) {
        supabase.from('messages').update({ read_at: now }).in('id', toMark).then(({ error }) => {
          if (!error) {
            setMessages(prev => prev.map(m => toMark.includes(m.id) ? { ...m, read_at: now } : m))
          }
        })
        // Also record per-user read receipts (for group "seen by" feature)
        const receiptRows = toMark.map(mid => ({ message_id: mid, user_id: user!.id, read_at: now }))
        supabase.from('message_read_receipts').upsert(receiptRows, { onConflict: 'message_id,user_id' }).then(({ error }) => {
          if (!error) {
            setMessages(prev => prev.map(m => {
              if (!toMark.includes(m.id)) return m
              const existing = m.read_receipts || []
              if (existing.some(r => r.user_id === user!.id)) return m
              return { ...m, read_receipts: [...existing, { message_id: m.id, user_id: user!.id, read_at: now }] }
            }))
          }
        })
      }
    }, { root, threshold: 0.5 })
    const els = root.querySelectorAll('[data-msg-id]')
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [messages, user])

  useEffect(() => subscribeUploads((uploads) => {
    setPendingUploads(uploads.filter(u => u.chatId === chatId))
  }), [chatId])

  useEffect(() => {
    const incoming = pendingUploads.filter(u => u.status !== 'done' && u.message)
    setMessages(prev => {
      const existingIds = new Set(prev.map(m => m.id))
      const toAdd = incoming.filter(u => u.message && !existingIds.has(u.message.id)).map(u => u.message!) as Message[]
      if (toAdd.length === 0) return prev
      return [...prev, ...toAdd]
    })
    const progressMap: Record<string, number> = {}
    for (const u of pendingUploads) { if (u.status === 'uploading') progressMap[u.tempId] = u.progress }
    setUploadProgress(prev => {
      const next = { ...prev }
      for (const u of pendingUploads) { if (u.status === 'uploading') next[u.tempId] = u.progress }
      return next
    })
    const doneIds = pendingUploads.filter(u => u.status === 'done' && u.message).map(u => u.message!.id)
    if (doneIds.length > 0) {
      setMessages(prev => prev.map(m => {
        const upload = pendingUploads.find(u => u.tempId === m.id)
        if (upload && upload.status === 'done' && upload.message && upload.message.id !== m.id) return upload.message
        return m
      }))
    }
  }, [pendingUploads])

  // Realtime for messages (incremental updates — no full reload)
  const senderCacheRef = useRef<Record<string, Profile>>({})

  useEffect(() => {
    if (!user) return
    const channel = supabase.channel(`messages-${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, async (payload: any) => {
        const newMsg = payload.new as Message
        if (newMsg.deleted_at) return
        // Use cached sender profile to avoid DB round-trip on every message
        let sender = senderCacheRef.current[newMsg.sender_id]
        if (!sender) {
          const { data } = await supabase.from('profiles').select('*').eq('id', newMsg.sender_id).single()
          sender = data as Profile
          if (sender) senderCacheRef.current[newMsg.sender_id] = sender
        }
        newMsg.sender = sender
        newMsg.reactions = []
        setMessages(prev => {
          if (prev.find(m => m.id === newMsg.id)) return prev
          if (newMsg.sender_id === user?.id) {
            const tempIdx = prev.findIndex(m => m.id.startsWith('temp-') && m.sender_id === user.id && m.content === newMsg.content && m.message_type === newMsg.message_type)
            if (tempIdx !== -1) {
              const copy = [...prev]
              copy[tempIdx] = newMsg
              return copy
            }
          }
          return [...prev, newMsg]
        })
        setTimeout(scrollToBottom, 50)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, async (payload: any) => {
        const updated = payload.new as Message
        if (updated.deleted_at) {
          setMessages(prev => prev.filter(m => m.id !== updated.id))
        } else {
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated, sender: m.sender, reactions: m.reactions, read_receipts: m.read_receipts } : m))
          if (updated.read_at) {
            const { data: receipts } = await supabase.from('message_read_receipts').select('message_id, user_id, read_at').eq('message_id', updated.id)
            if (receipts) {
              setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, read_receipts: receipts as ReadReceipt[] } : m))
            }
          }
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, (payload: any) => {
        const deleted = payload.old as Message
        setMessages(prev => prev.filter(m => m.id !== deleted.id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (payload: any) => {
        const row = payload.new
        if (!row || !row.message_id) return
        setMessages(prev => prev.map(m => m.id === row.message_id ? { ...m, reactions: [...(m.reactions || []), row] } : m))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (payload: any) => {
        const row = payload.old
        if (!row || !row.message_id) return
        setMessages(prev => prev.map(m => m.id === row.message_id ? { ...m, reactions: (m.reactions || []).filter(r => !(r.message_id === row.message_id && r.user_id === row.user_id && r.emoji === row.emoji)) } : m))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `chat_id=eq.${chatId}` }, (payload: any) => {
        const call = payload.new as Call
        if (call.callee_id === user.id && call.status === 'ringing') onCall?.(call.id)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_read_receipts' }, (payload: any) => {
        const row = payload.new as ReadReceipt
        if (!row || row.user_id === user.id) return
        setMessages(prev => prev.map(m => m.id === row.message_id ? { ...m, read_receipts: [...(m.read_receipts || []).filter(r => r.user_id !== row.user_id), row] } : m))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_read_receipts' }, (payload: any) => {
        const row = payload.new as ReadReceipt
        if (!row || row.user_id === user.id) return
        setMessages(prev => prev.map(m => m.id === row.message_id ? { ...m, read_receipts: [...(m.read_receipts || []).filter(r => r.user_id !== row.user_id), row] } : m))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [chatId, user, onCall, scrollToBottom])

  // Realtime for typing indicator: listen for other users' typing in this chat
  useEffect(() => {
    if (!user || !chatId) return
    const channel = supabase.channel(`typing-${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_typing', filter: `chat_id=eq.${chatId}` }, (payload: any) => {
        const row = payload.new || payload.old
        if (!row || row.user_id === user.id) return
        if (payload.eventType === 'DELETE') { setOtherTyping(false); return }
        const ageMs = Date.now() - new Date(row.updated_at).getTime()
        if (row.is_typing && ageMs < 4000) {
          lastTypingAtRef.current = new Date(row.updated_at).getTime()
          setOtherTyping(true)
        } else {
          setOtherTyping(false)
        }
      })
      .subscribe()
    // Poll to clear stale typing state when no further pings arrive
    const poll = setInterval(() => {
      if (lastTypingAtRef.current && Date.now() - lastTypingAtRef.current > 4000) {
        lastTypingAtRef.current = 0
        setOtherTyping(false)
      }
    }, 1000)
    // Poll to refresh read receipts (realtime fallback)
    const receiptPoll = setInterval(async () => {
      const ids = messagesRef.current.filter(m => !m.id.startsWith('temp-')).map(m => m.id)
      if (ids.length === 0) return
      const { data: receipts } = await supabase.from('message_read_receipts').select('message_id, user_id, read_at').in('message_id', ids)
      if (!receipts) return
      const byMsg: Record<string, ReadReceipt[]> = {}
      for (const r of receipts as ReadReceipt[]) {
        if (!byMsg[r.message_id]) byMsg[r.message_id] = []
        byMsg[r.message_id].push(r)
      }
      setMessages(prev => prev.map(m => {
        const next = byMsg[m.id] || []
        const cur = m.read_receipts || []
        if (next.length === cur.length && next.every(n => cur.some(c => c.user_id === n.user_id))) return m
        return { ...m, read_receipts: next }
      }))
    }, 8000)
    return () => { supabase.removeChannel(channel); clearInterval(poll); clearInterval(receiptPoll) }
  }, [chatId, user])

  const pingTyping = useCallback(() => {
    if (!user || !chatId) return
    const now = Date.now()
    if (now - lastTypingPingRef.current < 2000) return
    lastTypingPingRef.current = now
    supabase.from('chat_typing').upsert(
      { chat_id: chatId, user_id: user.id, is_typing: true, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id,user_id' }
    ).then(() => {})
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      supabase.from('chat_typing').upsert(
        { chat_id: chatId, user_id: user.id, is_typing: false, updated_at: new Date().toISOString() },
        { onConflict: 'chat_id,user_id' }
      ).then(() => {})
      lastTypingPingRef.current = 0
    }, 3000)
  }, [user, chatId])

  const clearTyping = useCallback(() => {
    if (!user || !chatId) return
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null }
    lastTypingPingRef.current = 0
    supabase.from('chat_typing').upsert(
      { chat_id: chatId, user_id: user.id, is_typing: false, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id,user_id' }
    ).then(() => {})
  }, [user, chatId])

  // Realtime for other user's online status
  useEffect(() => {
    if (!otherUser) return
    const channel = supabase.channel(`profile-${otherUser.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${otherUser.id}` }, (payload: any) => {
        const updated = payload.new as Profile
        setOtherUser(prev => prev ? { ...prev, is_online: updated.is_online, last_seen: updated.last_seen } : prev)
        setOtherOnline(updated.is_online || false)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [otherUser?.id])

  const sendMessage = async () => {
    if (!user || !input.trim()) return
    if (editingMsg) {
      saveEditMessage(editingMsg.id, input.trim())
      setInput('')
      return
    }
    const content = input.trim()
    const replyId = replyTo?.id || null
    setInput('')
    setReplyTo(null)
    clearTyping()

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimistic: Message = {
      id: tempId,
      chat_id: chatId,
      sender_id: user.id,
      content,
      created_at: new Date().toISOString(),
      message_type: 'text',
      file_url: null,
      file_name: null,
      file_size: null,
      duration: null,
      is_edited: false,
      is_pinned: false,
      reply_to: replyId,
      deleted_at: null,
      read_at: null,
      sender: profile || undefined,
      reactions: [],
    }
    setMessages(prev => [...prev, optimistic])
    scrollToBottom()
    window.dispatchEvent(new CustomEvent('chat-list-reload'))

    supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: user.id,
      content,
      message_type: 'text',
      reply_to: replyId,
    }).select(`*, sender:profiles!messages_sender_id_profiles_fkey(*), reactions(*)`).single().then(({ data, error }) => {
      if (error || !data) return
      const realMsg = data as unknown as Message
      setMessages(prev => prev.map(m => m.id === tempId ? realMsg : m))
      window.dispatchEvent(new CustomEvent('chat-list-reload'))
      sendPushNotification(chatId, realMsg.id, user.id, content, 'text')
    })
  }

  const sendFile = async (file: File, caption: string, type: 'image' | 'file') => {
    if (!user) return
    const replyId = replyTo?.id || null
    setReplyTo(null)
    startFileUpload(chatId, user.id, file, caption, type, replyId, profile || undefined)
    scrollToBottom()
  }

  const sendVoiceMessage = async (blob: Blob, duration: number) => {
    if (!user) return
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.webm`
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimistic: Message = {
      id: tempId, chat_id: chatId, sender_id: user.id, content: '',
      created_at: new Date().toISOString(), message_type: 'voice', file_url: null,
      file_name: 'voice.webm', file_size: blob.size, duration,
      is_edited: false, is_pinned: false, reply_to: replyTo?.id || null,
      deleted_at: null, read_at: null, sender: profile || undefined, reactions: [],
    }
    setMessages(prev => [...prev, optimistic])
    scrollToBottom()
    setUploadProgress(prev => ({ ...prev, [tempId]: 0 }))
    let filePath: string
    try {
      filePath = await uploadWithProgress('media', fileName, blob, (pct) => setUploadProgress(prev => ({ ...prev, [tempId]: pct })))
    } catch (e: any) { console.error(e); alert('ارسال فایل صوتی ناموفق بود'); setMessages(prev => prev.filter(m => m.id !== tempId)); setUploadProgress(prev => { const c = { ...prev }; delete c[tempId]; return c }); return }
    const fileUrl = `${supabaseUrl}/storage/v1/object/public/media/${filePath}`
    const { data } = await supabase.from('messages').insert({
      chat_id: chatId, sender_id: user.id, content: '',
      message_type: 'voice', file_url: fileUrl, file_name: 'voice.webm',
      duration, reply_to: replyTo?.id || null,
    }).select(`*, sender:profiles!messages_sender_id_profiles_fkey(*), reactions(*)`).single()
    setUploadProgress(prev => { const c = { ...prev }; delete c[tempId]; return c })
    if (data) {
      const realMsg = data as unknown as Message
      setMessages(prev => prev.map(m => m.id === tempId ? realMsg : m))
      window.dispatchEvent(new CustomEvent('chat-list-reload'))
      sendPushNotification(chatId, realMsg.id, user.id, '', 'voice')
    }
    setReplyTo(null)
  }

  const handleJoin = async () => {
    if (!user || !chatId) return
    setJoining(true)
    const { error } = await supabase.from('chat_members').insert({ chat_id: chatId, user_id: user.id, role: 'member' })
    setJoining(false)
    if (error) { alert('عضویت ناموفق بود'); return }
    setIsMember(true)
    if (onJoined) onJoined(chatId)
  }

  const handleDownload = async (msg: Message) => {
    if (!msg.file_url) return
    const key = msg.id
    const cached = await getCachedFile(key)
    if (cached) { openBlob(cached, msg.file_name || 'file'); return }
    setDownloadProgress(prev => ({ ...prev, [key]: 0 }))
    try {
      const blob = await downloadWithProgress(msg.file_url, msg.file_name || 'file', (pct) => setDownloadProgress(prev => ({ ...prev, [key]: pct })))
      await setCachedFile(key, blob)
      openBlob(blob, msg.file_name || 'file')
    } catch (e) { console.error(e); alert('دانلود فایل ناموفق بود') }
    setDownloadProgress(prev => { const c = { ...prev }; delete c[key]; return c })
  }

  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    (async () => {
      const ids = new Set<string>()
      for (const msg of messages) {
        if (msg.message_type === 'file' && msg.file_url) {
          const cached = await getCachedFile(msg.id)
          if (cached) ids.add(msg.id)
        }
      }
      setDownloadedIds(ids)
    })()
  }, [messages])

  const deleteMessage = async (msgId: string) => {
    await supabase.from('reactions').delete().eq('message_id', msgId)
    await supabase.from('messages').delete().eq('id', msgId)
    setMessages(prev => prev.filter(m => m.id !== msgId))
    setMenuMsgId(null)
    window.dispatchEvent(new CustomEvent('chat-list-reload'))
  }

  const saveEditMessage = async (msgId: string, newContent: string) => {
    if (!newContent.trim()) return
    await supabase.from('messages').update({ content: newContent.trim(), is_edited: true }).eq('id', msgId)
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: newContent.trim(), is_edited: true } : m))
    setEditingMsg(null)
    setMenuMsgId(null)
  }

  const toggleReaction = async (msgId: string, emoji: string) => {
    if (!user) return
    const { data: existing } = await supabase.from('reactions').select('*').eq('message_id', msgId).eq('user_id', user.id).eq('emoji', emoji).maybeSingle()
    if (existing) {
      await supabase.from('reactions').delete().eq('message_id', msgId).eq('user_id', user.id).eq('emoji', emoji)
    } else {
      await supabase.from('reactions').insert({ message_id: msgId, user_id: user.id, emoji })
    }
    const { data: reactions } = await supabase.from('reactions').select('*').eq('message_id', msgId)
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: reactions as Reaction[] || [] } : m))
    setShowReactionPicker(null)
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        if (cancelRecordingRef.current) { cancelRecordingRef.current = false; return }
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        sendVoiceMessage(blob, recordDuration)
      }
      recorder.start()
      setRecording(true)
      setRecordDuration(0)
      recordTimerRef.current = setInterval(() => setRecordDuration(prev => prev + 1), 1000)
    } catch (e) { console.error('Failed to start recording:', e) }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60); const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isSaved = chat?.type === 'saved'
  const title = isSaved ? 'پیام‌های ذخیره شده' : chat?.type === 'direct' ? (otherUser?.display_name || otherUser?.username || 'گفت‌وگو') : (chat?.title || (chat?.type === 'channel' ? 'کانال' : 'گروه'))
  const formatLastSeen = (dateStr: string | null) => {
    if (!dateStr) return 'اخیراً دیده شده'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHr / 24)
    const timeStr = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    const dateStrFa = date.toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' })
    if (diffMin < 1) return 'همین الان'
    if (diffMin < 60) return `${diffMin} دقیقه پیش`
    if (diffHr < 24 && date.getDate() === now.getDate()) return `امروز ${timeStr}`
    if (diffDay === 1) return `دیروز ${timeStr}`
    if (diffDay < 7) return `${diffDay} روز پیش`
    return `${dateStrFa} ${timeStr}`
  }
  const subtitle = isSaved ? 'پیام‌های ذخیره‌شده شما' : chat?.type === 'direct' ? (otherTyping ? 'در حال نوشتن...' : otherOnline ? 'آنلاین' : `آخرین بازدید: ${formatLastSeen(otherUser?.last_seen || null)}`) : chat?.type === 'channel' ? 'کانال' : (otherTyping ? 'در حال نوشتن...' : 'گروه')
  const canPost = !previewMode && isMember && (chat?.type !== 'channel' || myRole === 'owner' || myRole === 'admin')

  return (
    <div className="flex-1 flex flex-col bg-tg-bg h-full w-full relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 bg-tg-panel border-b border-tg-border">
        <button onClick={onBack} className="md:hidden text-tg-subtext hover:text-tg-text"><ArrowRight size={22} /></button>
        <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => isSaved ? undefined : (chat?.type === 'group' || chat?.type === 'channel') ? setShowGroupInfo(true) : setShowProfile(true)}>
          <div className="relative">
            {isSaved ? (
              <div className="w-10 h-10 rounded-full bg-tg-accent/20 flex items-center justify-center">
                <Bookmark size={20} className="text-tg-accent" />
              </div>
            ) : (
              <>
                <Avatar url={chat?.type === 'direct' ? (otherUser?.avatar_url || null) : (chat?.avatar_url || null)} name={title} size={40} />
                {chat?.type === 'direct' && <div className={`absolute bottom-0 left-0 w-3 h-3 rounded-full border-2 border-tg-panel ${otherOnline ? 'bg-tg-green' : 'bg-tg-subtext'}`} />}
              </>
            )}
          </div>
          <div>
            <p className="text-tg-text font-medium">{title}</p>
            <p className={`text-xs ${otherOnline && !isSaved ? 'text-tg-green' : 'text-tg-subtext'}`}>{subtitle}</p>
          </div>
        </div>
        {!isSaved && chat?.type !== 'channel' && <button onClick={() => startCall(false)} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-accent"><Phone size={20} /></button>}
        {!isSaved && chat?.type !== 'channel' && <button onClick={() => startCall(true)} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-accent"><Video size={20} /></button>}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto p-4 space-y-2 ${previewMode && previewPrivate && !isMember ? 'hidden' : ''}`} dir="rtl">
        {loading && <p className="text-center text-tg-subtext">در حال بارگذاری...</p>}
        {!loading && messages.length === 0 && <p className="text-center text-tg-subtext mt-8">پیامی وجود ندارد. اولین پیام را ارسال کنید!</p>}
        {messages.map((msg, idx) => {
          const isMine = msg.sender_id === user?.id
          const showAvatar = !isMine && chat?.type === 'group'
          const replied = msg.reply_to ? messages.find(m => m.id === msg.reply_to) : undefined
          const replyText = replied?.content || replied?.file_name || 'پیام'
          const replyIcon = replied?.message_type === 'image' ? '🖼' : replied?.message_type === 'file' ? (isVideoFile(replied.file_name) ? '🎬' : '📄') : replied?.message_type === 'voice' ? '🎤' : replied?.message_type === 'call' ? '📞' : ''
          const prevMsg = idx > 0 ? messages[idx - 1] : null
          const showDayDivider = !prevMsg || new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString()
          const isDownloaded = downloadedIds.has(msg.id)
          return (
            <div key={msg.id}>
              {showDayDivider && (
                <div className="flex items-center justify-center my-4">
                  <span className="bg-tg-hover/60 text-tg-subtext text-xs font-medium px-3 py-1 rounded-full">{formatDayDivider(msg.created_at)}</span>
                </div>
              )}
              <div className={`flex ${isMine ? 'justify-start' : 'justify-end'} group relative`}>
              {showAvatar && <Avatar url={msg.sender?.avatar_url} name={msg.sender?.display_name || msg.sender?.username || ''} size={28} />}
              <div data-msg-id={msg.id} className={`max-w-[70%] rounded-2xl px-3 py-2 ${showAvatar ? 'mr-2' : ''} transition-colors duration-500 ${highlightedMsgId === msg.id ? 'bg-tg-accent/30 ring-2 ring-tg-accent' : isMine ? 'bg-tg-active' : 'bg-tg-panel'}`} onDoubleClick={(e) => {
                if (showReactionPicker === msg.id) { setShowReactionPicker(null); setReactionPos(null) }
                else {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const top = Math.min(rect.bottom + 4, window.innerHeight - 188)
                  const left = isMine ? Math.max(8, rect.left) : Math.min(rect.right - 260, window.innerWidth - 268)
                  setReactionPos({ top: Math.max(8, top), left: Math.max(8, left) })
                  setShowReactionPicker(msg.id)
                }
              }}>
                {msg.reply_to && (
                  <button onClick={() => replied && scrollToMessage(replied.id)} className="border-r-2 border-tg-accent pr-2 mb-1 text-xs text-tg-subtext text-right block w-full hover:bg-tg-hover/50 rounded transition-colors">
                    {replyIcon && <span className="ml-1">{replyIcon}</span>}{replyText}
                  </button>
                )}
                {msg.message_type === 'image' && msg.file_url && (
                  <button onClick={() => {
                    const mediaItems = messages.filter(m => (m.message_type === 'image' || (m.message_type === 'file' && isVideoFile(m.file_name))) && m.file_url).map(m => ({ url: m.file_url!, type: isVideoFile(m.file_name) ? 'video' as const : 'image' as const, name: m.file_name || '' }))
                    const idx = mediaItems.findIndex(m => m.url === msg.file_url)
                    setMediaViewer({ items: mediaItems, index: idx >= 0 ? idx : 0 })
                  }} className="block relative group/img rounded-xl mb-1 overflow-hidden">
                    <img src={msg.file_url} alt={msg.file_name || ''} className="rounded-xl max-w-full max-h-80 object-cover transition-transform group-hover/img:scale-[1.02]" />
                  </button>
                )}
                {msg.message_type === 'image' && !msg.file_url && uploadProgress[msg.id] !== undefined && (
                  <div className="flex flex-col items-center gap-2 py-4 px-3 bg-black/20 rounded-xl mb-1 w-48">
                    <ImageIcon size={28} className="text-tg-subtext" />
                    <div className="w-full bg-tg-hover rounded-full h-1.5 overflow-hidden"><div className="bg-tg-accent h-full rounded-full transition-all" style={{ width: `${uploadProgress[msg.id]}%` }} /></div>
                    <span className="text-xs text-tg-subtext">{uploadProgress[msg.id]}%</span>
                  </div>
                )}
                {msg.message_type === 'file' && msg.file_url && isVideoFile(msg.file_name) && (
                  <button onClick={() => {
                    const mediaItems = messages.filter(m => (m.message_type === 'image' || (m.message_type === 'file' && isVideoFile(m.file_name))) && m.file_url).map(m => ({ url: m.file_url!, type: isVideoFile(m.file_name) ? 'video' as const : 'image' as const, name: m.file_name || '' }))
                    const idx = mediaItems.findIndex(m => m.url === msg.file_url)
                    setMediaViewer({ items: mediaItems, index: idx >= 0 ? idx : 0 })
                  }} className="block relative rounded-xl mb-1 overflow-hidden group/vid">
                    <video src={msg.file_url} className="rounded-xl max-w-full max-h-80 object-cover" preload="metadata" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/vid:bg-black/30 transition-colors">
                      <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                        <PlayCircle size={32} className="text-white" />
                      </div>
                    </div>
                  </button>
                )}
                {msg.message_type === 'file' && msg.file_url && !isVideoFile(msg.file_name) && (
                  <button onClick={() => handleDownload(msg)} className="flex items-center gap-3 bg-black/15 hover:bg-black/25 rounded-xl p-2.5 pr-3 text-right transition-colors min-w-[200px]">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDownloaded ? 'bg-tg-green/20' : 'bg-tg-accent/20'}`}>
                      {isDownloaded ? <FileText size={20} className="text-tg-green" /> : <Download size={20} className="text-tg-accent" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-tg-text truncate">{msg.file_name}</p>
                      {msg.file_size && <p className="text-xs text-tg-subtext">{formatFileSize(msg.file_size)}</p>}
                    </div>
                  </button>
                )}
                {msg.message_type === 'file' && msg.file_url && downloadProgress[msg.id] !== undefined && (
                  <div className="mt-1 w-48">
                    <div className="w-full bg-tg-hover rounded-full h-1.5 overflow-hidden"><div className="bg-tg-accent h-full rounded-full transition-all" style={{ width: `${downloadProgress[msg.id]}%` }} /></div>
                    <span className="text-xs text-tg-subtext mt-0.5 block">در حال دانلود... {downloadProgress[msg.id]}%</span>
                  </div>
                )}
                {msg.message_type === 'file' && !msg.file_url && uploadProgress[msg.id] !== undefined && (
                  <div className="flex flex-col items-start gap-2 py-2 w-48">
                    <div className="flex items-center gap-2 text-tg-subtext"><Loader2 size={18} className="animate-spin" /><span className="text-sm truncate">{msg.file_name}</span></div>
                    <div className="w-full bg-tg-hover rounded-full h-1.5 overflow-hidden"><div className="bg-tg-accent h-full rounded-full transition-all" style={{ width: `${uploadProgress[msg.id]}%` }} /></div>
                    <span className="text-xs text-tg-subtext">{uploadProgress[msg.id]}%</span>
                  </div>
                )}
                {msg.message_type === 'voice' && msg.file_url && (
                  <VoicePlayer src={msg.file_url} duration={msg.duration} isMine={isMine} />
                )}
                {msg.message_type === 'voice' && !msg.file_url && uploadProgress[msg.id] !== undefined && (
                  <div className="flex flex-col gap-1 w-44">
                    <div className="flex items-center gap-2 text-tg-subtext"><Loader2 size={16} className="animate-spin" /><span className="text-xs">در حال ارسال...</span></div>
                    <div className="w-full bg-tg-hover rounded-full h-1.5 overflow-hidden"><div className="bg-tg-accent h-full rounded-full transition-all" style={{ width: `${uploadProgress[msg.id]}%` }} /></div>
                  </div>
                )}
                {msg.message_type === 'call' && (
                  <div className="flex items-center gap-2 text-tg-subtext"><Phone size={16} /><span className="text-sm">{msg.content}</span></div>
                )}
                {msg.content && msg.message_type === 'text' && (
                  <p className="text-tg-text text-sm whitespace-pre-wrap break-words">
                    {linkify(msg.content, onOpenChatWithUsername, onOpenChatWithPhone)}
                  </p>
                )}
                {msg.content && msg.message_type === 'image' && <p className="text-tg-text text-sm mt-1">{linkify(msg.content, onOpenChatWithUsername, onOpenChatWithPhone)}</p>}
                {msg.content && msg.message_type === 'file' && <p className="text-tg-text text-sm mt-1">{linkify(msg.content, onOpenChatWithUsername, onOpenChatWithPhone)}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-xs text-tg-subtext">{formatTime(msg.created_at)}</span>
                  {msg.is_edited && <span className="text-xs text-tg-subtext">ویرایش شده</span>}
                  {chat?.type === 'channel' ? (
                    <span className="flex items-center gap-0.5 text-xs text-tg-subtext">
                      <Eye size={13} />
                      {(() => {
                        const readers = (msg.read_receipts || []).filter(r => r.user_id !== msg.sender_id)
                        return readers.length.toLocaleString('fa-IR')
                      })()}
                    </span>
                  ) : (
                    isMine && (msg.read_at ? <CheckCheck size={14} className="text-tg-blue" /> : <Check size={14} className="text-tg-subtext" />)
                  )}
                </div>
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {msg.reactions.reduce((acc: { emoji: string; count: number }[], r) => {
                      const existing = acc.find(a => a.emoji === r.emoji)
                      if (existing) existing.count++
                      else acc.push({ emoji: r.emoji, count: 1 })
                      return acc
                    }, []).map((r, i) => {
                      const hasReacted = msg.reactions?.some(react => react.emoji === r.emoji && react.user_id === user?.id)
                      return (
                        <button key={i} onClick={() => toggleReaction(msg.id, r.emoji)} className={`rounded-full px-2 py-0.5 text-xs transition-colors ${hasReacted ? 'bg-tg-accent/30 ring-1 ring-tg-accent' : 'bg-tg-hover hover:bg-tg-border'}`}>{r.emoji} {r.count}</button>
                      )
                    })}
                  </div>
                )}
              </div>
              <button onClick={(e) => {
                if (menuMsgId === msg.id) { setMenuMsgId(null); setMenuPos(null) }
                else { setMenuPos(computeMenuPos(e, 160)); setMenuMsgId(msg.id) }
              }} className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext self-center">
                <MoreVertical size={14} />
              </button>
              {menuMsgId === msg.id && menuPos && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setMenuMsgId(null); setMenuPos(null) }} />
                  <div className="fixed z-50 bg-tg-panel rounded-xl shadow-2xl border border-tg-hover py-1 min-w-[140px]" style={{ top: menuPos.top, left: menuPos.left }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setReplyTo(msg); setMenuMsgId(null); setMenuPos(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><Reply size={14} /> پاسخ</button>
                    {msg.content && <button onClick={async () => {
                      try {
                        if (navigator.clipboard && window.isSecureContext) {
                          await navigator.clipboard.writeText(msg.content)
                        } else {
                          const ta = document.createElement('textarea')
                          ta.value = msg.content
                          ta.style.position = 'fixed'
                          ta.style.opacity = '0'
                          document.body.appendChild(ta)
                          ta.focus()
                          ta.select()
                          document.execCommand('copy')
                          document.body.removeChild(ta)
                        }
                      } catch {}
                      setMenuMsgId(null)
                      setMenuPos(null)
                    }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><Copy size={14} /> کپی متن</button>}
                    <button onClick={() => { setForwardMsg(msg); setMenuMsgId(null); setMenuPos(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><Forward size={14} /> فروارد</button>
                    {isMine && (() => {
                      const readers = (msg.read_receipts || []).filter(r => r.user_id !== msg.sender_id)
                      const label = chat?.type === 'direct'
                        ? (msg.read_at ? `دیده شده ${formatMessageTime(msg.read_at)}` : 'دیده نشده')
                        : (readers.length > 0 ? `دیده شده توسط ${readers.length} نفر` : 'دیده نشده')
                      return <button onClick={async () => { seenByPosRef.current = menuPos; setMenuMsgId(null); setMenuPos(null); if (chat?.type !== 'direct' && readers.length > 0) { const ids = readers.map(r => r.user_id); const { data: profs } = await supabase.from('profiles').select('*').in('id', ids); const map: Record<string, Profile> = {}; (profs || []).forEach(p => { map[p.id] = p }); setSeenByProfiles(map); setSeenByMsg(msg) } else { setSeenByMsg(msg) } }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><CheckCheck size={14} /> {label}</button>
                    })()}
                    <button onClick={(e) => { setReactionPos(computeMenuPos(e, 180, 260)); setShowReactionPicker(msg.id); setMenuMsgId(null); setMenuPos(null) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><Smile size={14} /> واکنش</button>
                    {isMine && msg.message_type === 'text' && <button onClick={() => { setEditingMsg(msg); setInput(msg.content); setMenuMsgId(null); setMenuPos(null); setTimeout(() => textareaRef.current?.focus(), 0) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><Pencil size={14} /> ویرایش</button>}
                    {isMine && <button onClick={() => deleteMessage(msg.id)} className="w-full flex items-center gap-2 px-4 py-2 text-tg-red hover:bg-tg-hover text-sm"><Trash2 size={14} /> حذف</button>}
                  </div>
                </>
              )}
              {showReactionPicker === msg.id && reactionPos && (
                <ReactionPicker top={reactionPos.top} left={reactionPos.left} onSelect={(emoji) => toggleReaction(msg.id, emoji)} onClose={() => { setShowReactionPicker(null); setReactionPos(null) }} />
              )}
            </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Private chat preview overlay — confirmation panel before joining */}
      {previewMode && previewPrivate && !isMember && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-tg-bg/95 backdrop-blur-sm px-6 text-center animate-[fadeIn_0.2s_ease-out]">
          <div className="w-24 h-24 rounded-full bg-tg-accent/15 flex items-center justify-center mb-4">
            {chat?.avatar_url ? (
              <img src={chat.avatar_url} alt="" className="w-24 h-24 rounded-full object-cover" />
            ) : (
              <Users size={44} className="text-tg-accent" />
            )}
          </div>
          <h2 className="text-tg-text text-xl font-semibold mb-1">{chat?.title || 'گروه'}</h2>
          <p className="text-tg-subtext text-sm mb-8 max-w-xs">
            {chat?.type === 'channel' ? 'برای مشاهده این کانال خصوصی، عضو شوید' : 'برای مشاهده این گروه خصوصی، عضو شوید'}
          </p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button onClick={handleJoin} disabled={joining} className="w-full bg-tg-accent hover:bg-tg-accent2 text-white font-semibold rounded-xl py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {joining ? '...' : <><Plus size={18} /> عضو شدن</>}
            </button>
            <button onClick={onBack} className="w-full bg-tg-hover hover:bg-tg-border text-tg-text font-medium rounded-xl py-3 transition-colors">
              بستن
            </button>
          </div>
        </div>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 py-2 bg-tg-panel border-t border-tg-hover flex items-center gap-2">
          <Reply size={16} className="text-tg-accent" />
          <div className="flex-1 text-sm text-tg-subtext truncate">{replyTo.content || replyTo.file_name || 'پیام'}</div>
          <button onClick={() => setReplyTo(null)} className="text-tg-subtext hover:text-tg-text"><X size={16} /></button>
        </div>
      )}

      {/* Edit preview */}
      {editingMsg && (
        <div className="px-4 py-2 bg-tg-panel border-t border-tg-hover flex items-center gap-2">
          <Pencil size={16} className="text-tg-accent" />
          <div className="flex-1 text-sm text-tg-subtext truncate">{editingMsg.content}</div>
          <button onClick={() => { setEditingMsg(null); setInput('') }} className="text-tg-subtext hover:text-tg-text"><X size={16} /></button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 bg-tg-panel border-t border-tg-border">
        {previewMode && !isMember ? (
          <button onClick={handleJoin} disabled={joining} className="w-full bg-tg-accent hover:bg-tg-accent2 text-white font-semibold rounded-xl py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {joining ? '...' : <><Plus size={18} /> عضو شدن</>}
          </button>
        ) : !canPost ? (
          <div className="flex items-center justify-center gap-2 py-2.5 text-tg-subtext text-sm">
            <Megaphone size={18} />
            <span>در این کانال فقط مدیران می‌توانند پیام ارسال کنند</span>
          </div>
        ) : recording ? (
          <div className="flex items-center gap-3 px-1 py-1 animate-[fadeIn_0.15s_ease-out]">
            <button onClick={() => { cancelRecordingRef.current = true; mediaRecorderRef.current?.stop(); setRecording(false); if (recordTimerRef.current) clearInterval(recordTimerRef.current) }} className="w-10 h-10 rounded-full bg-tg-hover hover:bg-tg-red/15 text-tg-subtext hover:text-tg-red flex items-center justify-center transition-colors"><Trash2 size={18} /></button>
            <div className="flex-1 flex items-center gap-2.5 h-10 px-3 bg-tg-hover rounded-xl">
              <span className="w-2.5 h-2.5 rounded-full bg-tg-red animate-pulse shrink-0" />
              <div className="flex items-center gap-[3px] h-5 flex-1" dir="ltr">
                {Array.from({ length: 28 }).map((_, i) => (
                  <span key={i} className="flex-1 rounded-full bg-tg-accent/60" style={{ height: `${20 + Math.abs(Math.sin(i * 0.9 + recordDuration)) * 60}%`, animationDelay: `${i * 30}ms` }} />
                ))}
              </div>
              <span className="text-tg-text text-sm tabular-nums font-medium shrink-0" dir="ltr">{formatDuration(recordDuration)}</span>
            </div>
            <button onClick={stopRecording} className="w-10 h-10 rounded-full bg-tg-accent hover:bg-tg-accent2 flex items-center justify-center transition-colors shadow-md"><Send size={18} className="text-white" /></button>
          </div>
        ) : (
          <div className="flex items-end gap-2 relative">
            {(showAttach || showEmoji) && (
              <div className="fixed inset-0 z-40" onClick={() => { setShowAttach(false); setShowEmoji(false) }} />
            )}
            {showAttach && (
              <div className="absolute bottom-full mb-2 right-0 bg-tg-panel rounded-xl shadow-2xl border border-tg-hover py-2 z-50 min-w-[140px]">
                <button onClick={() => { setShowAttach(false); setTimeout(() => imageInputRef.current?.click(), 100) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><ImageIcon size={16} /> تصویر</button>
                <button onClick={() => { setShowAttach(false); setTimeout(() => videoInputRef.current?.click(), 100) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><FileVideo size={16} /> ویدیو</button>
                <button onClick={() => { setShowAttach(false); setTimeout(() => fileInputRef.current?.click(), 100) }} className="w-full flex items-center gap-2 px-4 py-2 text-tg-text hover:bg-tg-hover text-sm"><FileText size={16} /> فایل</button>
              </div>
            )}
            <div className="relative">
              <button onClick={() => setShowAttach(!showAttach)} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext"><Paperclip size={20} /></button>
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" style={{ position: 'absolute', left: '-9999px', opacity: 0, width: 1, height: 1 }} onChange={e => { const f = e.target.files?.[0]; if (f) { setShowFileModal({ type: 'image', file: f }); } e.target.value = '' }} />
            <input ref={videoInputRef} type="file" accept="video/*" style={{ position: 'absolute', left: '-9999px', opacity: 0, width: 1, height: 1 }} onChange={e => { const f = e.target.files?.[0]; if (f) { setShowFileModal({ type: 'file', file: f }); } e.target.value = '' }} />
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.apk,.dmg,.exe,.json,.xml,.html,.htm,.md,.epub,.mobi,application/pdf,text/plain,text/csv,application/zip,application/x-rar-compressed,application/x-7z-compressed,application/msword,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/json,application/xml,text/html,text/markdown,application/epub+zip,application/octet-stream" style={{ position: 'absolute', left: '-9999px', opacity: 0, width: 1, height: 1 }} onChange={e => { const f = e.target.files?.[0]; if (f) { setShowFileModal({ type: 'file', file: f }); } e.target.value = '' }} />
            <div className="relative">
              <button onClick={() => setShowEmoji(!showEmoji)} className="w-9 h-9 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext"><Smile size={20} /></button>
              {showEmoji && (
                <div className="absolute bottom-full mb-2 left-0 bg-tg-panel rounded-xl shadow-2xl border border-tg-hover p-2 z-50 grid grid-cols-8 gap-1">
                  {['😀','😂','❤️','👍','🔥','🎉','😢','😡','🙏','👏','💯','😎','🤔','😴','🥳','😱','🤝','💪','🌟','✨','🎁','🌹','🍕','☕'].map(e => (
                    <button key={e} onClick={() => { setInput(prev => prev + e); setShowEmoji(false) }} className="text-2xl hover:bg-tg-hover rounded p-1">{e}</button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => { setInput(e.target.value); pingTyping() }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } if (e.key === 'Escape' && editingMsg) { setEditingMsg(null); setInput('') } }}
              placeholder="پیام بنویسید..."
              className="flex-1 bg-tg-hover rounded-xl px-4 py-2.5 text-tg-text placeholder-tg-subtext outline-none text-sm resize-none overflow-y-auto leading-6"
              dir="rtl"
              rows={1}
              style={{ maxHeight: '120px' }}
            />
            {input.trim() || editingMsg ? (
              <button onClick={sendMessage} className="w-10 h-10 rounded-full bg-tg-accent hover:bg-tg-accent2 flex items-center justify-center">{editingMsg ? <Check size={18} className="text-white" /> : <Send size={18} className="text-white" />}</button>
            ) : (
              <button onMouseDown={startRecording} className="w-10 h-10 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext"><Mic size={20} /></button>
            )}
          </div>
        )}
      </div>

      {forwardMsg && (
        <ForwardModal
          onClose={() => setForwardMsg(null)}
          onForward={async (targetChat) => {
            if (!user) return
            const insertData: any = {
              chat_id: targetChat.id,
              sender_id: user.id,
              content: forwardMsg.content || '',
              message_type: forwardMsg.message_type,
              file_url: forwardMsg.file_url,
              file_name: forwardMsg.file_name,
              file_size: forwardMsg.file_size,
              duration: forwardMsg.duration,
            }
            const { data } = await supabase.from('messages').insert(insertData)
              .select(`*, sender:profiles!messages_sender_id_profiles_fkey(*), reactions(*)`).single()
            if (data) {
              sendPushNotification(targetChat.id, (data as any).id, user.id, forwardMsg.content || '', forwardMsg.message_type as any)
              if (targetChat.id === chatId) {
                setMessages(prev => [...prev, data as unknown as Message])
                scrollToBottom()
              }
              window.dispatchEvent(new CustomEvent('chat-list-reload'))
            }
            setForwardMsg(null)
          }}
        />
      )}
      {showFileModal && (
        <FileCaptionModal
          type={showFileModal.type}
          file={showFileModal.file}
          onSend={(caption) => { sendFile(showFileModal.file, caption, showFileModal.type); setShowFileModal(null) }}
          onClose={() => setShowFileModal(null)}
        />
      )}
      {showGroupInfo && chat && <GroupInfoModal chat={chat} onClose={() => setShowGroupInfo(false)} onChatUpdated={loadChat} />}
      {showProfile && otherUser && <ProfileModal userId={otherUser.id} onClose={() => setShowProfile(false)} />}
      {mediaViewer && <MediaViewer items={mediaViewer.items} startIndex={mediaViewer.index} onClose={() => setMediaViewer(null)} />}
      {seenByMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setSeenByMsg(null); setSeenByProfiles({}) }}>
          <div className="bg-tg-panel rounded-xl shadow-xl w-72 max-w-[85vw] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-tg-border">
              <span className="text-tg-text font-medium text-sm">اطلاعات دیدن پیام</span>
              <button onClick={() => { setSeenByMsg(null); setSeenByProfiles({}) }} className="text-tg-subtext hover:text-tg-text"><X size={18} /></button>
            </div>
            <div className="py-2 max-h-72 overflow-y-auto">
              {chat?.type === 'direct' ? (
                <div className="px-4 py-3 text-sm text-tg-text">
                  {seenByMsg.read_at ? (
                    <div className="flex items-center gap-2"><CheckCheck size={16} className="text-tg-blue" /> دیده شده در {formatMessageTime(seenByMsg.read_at)}</div>
                  ) : (
                    <div className="flex items-center gap-2 text-tg-subtext"><Check size={16} /> هنوز دیده نشده</div>
                  )}
                </div>
              ) : (
                <>
                  {(seenByMsg.read_receipts || []).filter(r => r.user_id !== seenByMsg.sender_id).length === 0 ? (
                    <div className="px-4 py-3 text-sm text-tg-subtext">هنوز کسی این پیام را ندیده است</div>
                  ) : (
                    (seenByMsg.read_receipts || []).filter(r => r.user_id !== seenByMsg.sender_id).sort((a, b) => new Date(a.read_at).getTime() - new Date(b.read_at).getTime()).map(r => {
                      const p = seenByProfiles[r.user_id]
                      const name = p?.display_name || p?.username || 'کاربر'
                      return (
                        <div key={r.user_id} className="flex items-center gap-3 px-4 py-2 hover:bg-tg-hover">
                          <Avatar url={p?.avatar_url || null} name={name} size={32} />
                          <div className="flex-1 min-w-0">
                            <p className="text-tg-text text-sm truncate">{name}</p>
                            <p className="text-tg-subtext text-xs">دیده شده در {formatMessageTime(r.read_at)}</p>
                          </div>
                          <CheckCheck size={16} className="text-tg-blue" />
                        </div>
                      )
                    })
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  async function startCall(video: boolean) {
    if (!user || !chat) return
    if (chat.type === 'direct') {
      if (!otherUser) return
      const { data: call } = await supabase.from('calls').insert({
        chat_id: chatId, caller_id: user.id, callee_id: otherUser.id, status: 'ringing', video,
      }).select().single()
      if (call) onCall?.(call.id)
    } else {
      // Group call: create a single call row + join as participant
      const { data: call } = await supabase.from('calls').insert({
        chat_id: chatId, caller_id: user.id, callee_id: user.id, status: 'ringing', video, is_group_call: true,
      }).select().single()
      if (call) {
        // Insert self as first participant
        await supabase.from('call_participants').insert({
          call_id: call.id, user_id: user.id, video_enabled: video, audio_enabled: true,
        })
        onCall?.(call.id)
      }
    }
  }
}
