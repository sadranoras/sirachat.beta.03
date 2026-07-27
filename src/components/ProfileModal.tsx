import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Profile, Message } from '../lib/types'
import { X, Bell, AtSign, Info, MessageCircle, Flag, Shield, Phone, Image as ImageIcon, Mic, FileText, ChevronLeft, Play, Download, Video as VideoIcon } from 'lucide-react'
import Avatar from './Avatar'
import { isVideoFile } from '../lib/videoUtils'
import MediaViewer, { MediaItem } from './MediaViewer'

interface ProfileModalProps { userId: string; onClose: () => void; onMessage?: () => void }

const REPORT_REASONS = [
  { key: 'spam', label: 'اسپم' },
  { key: 'abuse', label: 'توهین و آزار' },
  { key: 'fake', label: 'حساب جعلی' },
  { key: 'inappropriate', label: 'محتوای نامناسب' },
  { key: 'other', label: 'سایر' },
]

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

export default function ProfileModal({ userId, onClose, onMessage }: ProfileModalProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showReport, setShowReport] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDesc, setReportDesc] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [mediaMessages, setMediaMessages] = useState<Message[]>([])
  const [loadingMedia, setLoadingMedia] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [playingVoice, setPlayingVoice] = useState<string | null>(null)
  const [videoViewer, setVideoViewer] = useState<{ items: MediaItem[]; index: number } | null>(null)

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', userId).single().then(({ data }) => {
      if (data) setProfile(data as Profile)
      setLoading(false)
    })
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null))
    const channel = supabase.channel(`profile-modal-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload: any) => {
        setProfile(payload.new as Profile)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const loadSharedMedia = async () => {
    if (!currentUserId) return
    setLoadingMedia(true)
    const { data: myMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', currentUserId)
    const { data: theirMemberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', userId)
    const myChatIds = (myMemberships || []).map((m: any) => m.chat_id)
    const theirChatIds = (theirMemberships || []).map((m: any) => m.chat_id)
    const sharedChatIds = myChatIds.filter(id => theirChatIds.includes(id))
    if (sharedChatIds.length === 0) { setMediaMessages([]); setLoadingMedia(false); return }
    const { data: msgs } = await supabase.from('messages')
      .select('*')
      .in('chat_id', sharedChatIds)
      .in('message_type', ['image', 'voice', 'file'])
      .not('file_url', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
    setMediaMessages((msgs || []) as Message[])
    setLoadingMedia(false)
  }

  useEffect(() => {
    if (currentUserId && activeTab !== 'info' && mediaMessages.length === 0 && !loadingMedia) {
      loadSharedMedia()
    }
  }, [currentUserId, activeTab])

  const photos = useMemo(() => mediaMessages.filter(m => m.message_type === 'image'), [mediaMessages])
  const videoMsgs = useMemo(() => mediaMessages.filter(m => m.message_type === 'file' && isVideoFile(m.file_name)), [mediaMessages])
  const voiceMsgs = useMemo(() => mediaMessages.filter(m => m.message_type === 'voice'), [mediaMessages])
  const fileMsgs = useMemo(() => mediaMessages.filter(m => m.message_type === 'file' && !isVideoFile(m.file_name)), [mediaMessages])

  const formatLastSeen = () => {
    if (!profile?.last_seen) return 'اخیراً دیده شده'
    const date = new Date(profile.last_seen)
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000)
    const timeStr = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    const dateStrFa = date.toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' })
    if (diffMin < 1) return 'همین الان'
    if (diffMin < 60) return `${diffMin} دقیقه پیش`
    if (diffMin < 1440 && date.getDate() === now.getDate()) return `امروز ${timeStr}`
    if (diffMin < 2880) return `دیروز ${timeStr}`
    return `${dateStrFa} ${timeStr}`
  }

  const submitReport = async () => {
    if (!reportReason) return
    setReporting(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setReporting(false); return }
    const { error } = await supabase.from('reports').insert({
      reporter_id: user.id,
      reported_id: userId,
      reason: reportReason,
      description: reportDesc || null,
    })
    setReporting(false)
    if (!error) setReportSent(true)
  }

  const tabs: { key: Tab; label: string; icon: typeof ImageIcon; count: number }[] = [
    { key: 'info', label: 'اطلاعات', icon: Info, count: -1 },
    { key: 'photos', label: 'عکس', icon: ImageIcon, count: photos.length },
    { key: 'videos', label: 'ویدئو', icon: VideoIcon, count: videoMsgs.length },
    { key: 'voice', label: 'ویس', icon: Mic, count: voiceMsgs.length },
    { key: 'files', label: 'فایل', icon: FileText, count: fileMsgs.length },
  ]

  if (loading) return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="w-10 h-10 border-2 border-tg-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!profile) return null

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        className="bg-tg-panel rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto animate-slideUp shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header banner with gradient */}
        <div className="relative bg-gradient-to-b from-tg-active to-tg-panel pb-4">
          <button onClick={onClose} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white transition-colors">
            <X size={20} />
          </button>
          <div className="flex flex-col items-center pt-8 px-6">
            <div className="relative">
              <Avatar url={profile.avatar_url} name={profile.display_name || profile.username || ''} size={110} />
              {profile.is_online ? (
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-tg-panel border-2 border-tg-panel flex items-center justify-center">
                  <div className="w-3.5 h-3.5 rounded-full bg-tg-green" />
                </div>
              ) : (
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-tg-panel border-2 border-tg-panel flex items-center justify-center">
                  <div className="w-3.5 h-3.5 rounded-full bg-tg-subtext" />
                </div>
              )}
            </div>
            <h2 className="text-xl font-bold text-white mt-4">{profile.display_name || profile.username || 'بدون نام'}</h2>
            <p className={`text-sm mt-1 ${profile.is_online ? 'text-tg-green' : 'text-white/60'}`}>
              {profile.is_online ? 'آنلاین' : `آخرین بازدید ${formatLastSeen()}`}
            </p>
          </div>
        </div>

        {/* Tab bar */}
        {!showReport && (
          <div className="flex border-b border-tg-hover bg-tg-panel sticky top-0 z-10">
            {tabs.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors relative ${isActive ? 'text-tg-accent' : 'text-tg-subtext hover:text-tg-text'}`}
                >
                  <Icon size={20} />
                  <span className="text-xs">{tab.label}</span>
                  {tab.count >= 0 && tab.count > 0 && (
                    <span className="text-[10px] text-tg-subtext">{tab.count}</span>
                  )}
                  {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-tg-accent" />}
                </button>
              )
            })}
          </div>
        )}

        {/* Action buttons row - only on info tab */}
        {activeTab === 'info' && onMessage && !showReport && (
          <div className="flex justify-center gap-3 px-6 -mt-2 mb-2">
            <button onClick={onMessage} className="flex flex-col items-center gap-1 px-6 py-2.5 rounded-xl bg-tg-hover hover:bg-tg-active/60 transition-colors text-tg-text">
              <MessageCircle size={22} />
              <span className="text-xs">پیام</span>
            </button>
          </div>
        )}

        {/* Report view */}
        {showReport ? (
          <div className="px-5 pb-6">
            {reportSent ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="w-14 h-14 rounded-full bg-tg-green/20 flex items-center justify-center mb-4">
                  <Shield size={28} className="text-tg-green" />
                </div>
                <p className="text-tg-text font-medium">گزارش شما ارسال شد</p>
                <p className="text-tg-subtext text-sm mt-1">به‌زودی بررسی خواهد شد.</p>
                <button onClick={onClose} className="mt-6 px-8 py-2.5 rounded-xl bg-tg-accent text-white text-sm font-medium hover:bg-tg-accent2 transition-colors">
                  بستن
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4 pt-2">
                  <button onClick={() => setShowReport(false)} className="text-tg-subtext hover:text-tg-text"><ChevronLeft size={22} /></button>
                  <Flag size={20} className="text-tg-red" />
                  <h3 className="text-tg-text font-medium">گزارش کاربر</h3>
                </div>
                <p className="text-tg-subtext text-sm mb-4">دلیل گزارش را انتخاب کنید:</p>
                <div className="space-y-1.5 mb-4">
                  {REPORT_REASONS.map(r => (
                    <button
                      key={r.key}
                      onClick={() => setReportReason(r.key)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                        reportReason === r.key
                          ? 'bg-tg-accent/20 border border-tg-accent text-tg-text'
                          : 'bg-tg-hover hover:bg-tg-active/40 text-tg-text border border-transparent'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${reportReason === r.key ? 'border-tg-accent bg-tg-accent' : 'border-tg-subtext'}`} />
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={reportDesc}
                  onChange={e => setReportDesc(e.target.value)}
                  placeholder="توضیحات (اختیاری)..."
                  className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none text-sm resize-none h-20"
                  dir="rtl"
                />
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={submitReport}
                    disabled={!reportReason || reporting}
                    className="flex-1 py-2.5 rounded-xl bg-tg-red text-white text-sm font-medium hover:bg-tg-red/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reporting ? 'در حال ارسال...' : 'ارسال گزارش'}
                  </button>
                  <button onClick={() => setShowReport(false)} className="px-5 py-2.5 rounded-xl bg-tg-hover text-tg-text text-sm hover:bg-tg-active/40 transition-colors">
                    انصراف
                  </button>
                </div>
              </>
            )}
          </div>
        ) : activeTab === 'info' ? (
          <>
            {/* Info section */}
            <div className="px-3 pb-3 space-y-1">
              {profile.bio && (
                <div className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-tg-hover transition-colors">
                  <Info size={20} className="text-tg-subtext flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-tg-text text-sm leading-relaxed">{profile.bio}</p>
                    <p className="text-tg-subtext text-xs mt-0.5">درباره</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-tg-hover transition-colors">
                <AtSign size={20} className="text-tg-subtext flex-shrink-0" />
                <div>
                  <p className="text-tg-text text-sm">{profile.username}</p>
                  <p className="text-tg-subtext text-xs mt-0.5">نام کاربری</p>
                </div>
              </div>

              {profile.phone && (profile.phone_visible || currentUserId === userId) && (
                <div className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-tg-hover transition-colors">
                  <Phone size={20} className="text-tg-subtext flex-shrink-0" />
                  <div>
                    <p className="text-tg-text text-sm" dir="ltr">{profile.phone}</p>
                    <p className="text-tg-subtext text-xs mt-0.5">شماره تلفن{currentUserId === userId && !profile.phone_visible ? ' (مخفی)' : ''}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-tg-hover transition-colors">
                <Bell size={20} className="text-tg-subtext flex-shrink-0" />
                <div>
                  <p className="text-tg-text text-sm">اعلان‌ها</p>
                  <p className="text-tg-subtext text-xs mt-0.5">فعال</p>
                </div>
              </div>
            </div>

            {/* Report button */}
            <div className="px-3 pb-6 pt-1">
              <button
                onClick={() => setShowReport(true)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-tg-red/10 text-tg-red transition-colors"
              >
                <Flag size={20} />
                <span className="text-sm font-medium">گزارش کاربر</span>
              </button>
            </div>
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
                  <p className="text-sm">عکسی به اشتراک گذاشته نشده</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-0.5 p-0.5">
                  {photos.map(msg => (
                    <button
                      key={msg.id}
                      onClick={() => setLightbox(msg.file_url)}
                      className="aspect-square overflow-hidden bg-tg-hover group relative"
                    >
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
                      <button
                        onClick={() => setPlayingVoice(playingVoice === msg.id ? null : msg.id)}
                        className="w-10 h-10 rounded-full bg-tg-accent flex items-center justify-center flex-shrink-0 hover:bg-tg-accent2 transition-colors"
                      >
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
                    <a
                      key={msg.id}
                      href={msg.file_url!}
                      download={msg.file_name || undefined}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-tg-hover transition-colors group"
                    >
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
