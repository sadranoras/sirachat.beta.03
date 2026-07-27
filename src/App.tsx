import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import { Call } from './lib/types'
import { subscribeToPush } from './lib/push'
import AuthScreen from './components/AuthScreen'
import ChatList from './components/ChatList'
import ChatView from './components/ChatView'
import NewChatModal from './components/NewChatModal'
import SettingsPanel from './components/SettingsPanel'
import ProfileModal from './components/ProfileModal'
import AdminPanel from './components/AdminPanel'
import CallModal from './components/CallModal'
import GroupCallModal from './components/GroupCallModal'
import InstallBanner from './components/InstallBanner'
import SplashScreen from './components/SplashScreen'
import { MessageCircle } from 'lucide-react'

function getJoinTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('join')
}

function clearJoinTokenFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete('join')
  window.history.replaceState({}, '', url.toString())
}

export default function App() {
  const { user, profile, loading } = useAuth()
  const [selectedChatId, setSelectedChatId] = useState('')
  const [previewChatId, setPreviewChatId] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [activeCallId, setActiveCallId] = useState<string | null>(null)
  const [callData, setCallData] = useState<Call | null>(null)
  const [callMinimized, setCallMinimized] = useState(false)
  const [otherUserName, setOtherUserName] = useState('')
  const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null)
  const [groupCallChatId, setGroupCallChatId] = useState<string | null>(null)
  const [groupCallStarter, setGroupCallStarter] = useState(false)
  const [joinStatus, setJoinStatus] = useState<'idle' | 'joining' | 'joined' | 'error' | 'already'>('idle')
  const [joinChatName, setJoinChatName] = useState<string | null>(null)
  const [previewChat, setPreviewChat] = useState<{ id: string; isPrivate: boolean } | null>(null)

  // Ref to avoid stale closure in polling interval
  const activeCallIdRef = useRef<string | null>(null)
  activeCallIdRef.current = activeCallId

  const loadCallInfo = useCallback(async (call: Call, currentUserId: string) => {
    const otherId = call.caller_id === currentUserId ? call.callee_id : call.caller_id
    const { data: p } = await supabase.from('profiles').select('*').eq('id', otherId).single()
    if (p) {
      setOtherUserName((p as any).display_name || (p as any).username)
      setOtherUserAvatar((p as any).avatar_url)
    }
  }, [])

  const handleIncomingCall = useCallback((call: Call) => {
    if (activeCallIdRef.current) return
    setCallData(call)
    setActiveCallId(call.id)
    // Only show full-screen call UI if the user is currently viewing that chat;
    // otherwise just show the floating banner at the top.
    setCallMinimized(selectedChatId !== call.chat_id)
    if (call.is_group_call) {
      setGroupCallChatId(call.chat_id)
      setGroupCallStarter(false)
    } else if (user) {
      loadCallInfo(call, user.id)
    }
  }, [user, loadCallInfo, selectedChatId])

  // Listen for incoming calls via realtime + polling fallback
  useEffect(() => {
    if (!user) return

    // Realtime subscription for incoming calls
    const channel = supabase.channel('incoming-calls')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'calls',
        filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => {
        const call = payload.new as Call
        if (call.status === 'ringing') {
          handleIncomingCall(call)
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => {
        const call = payload.new as Call
        // If a call transitions to ringing (sometimes INSERT is missed)
        if (call.status === 'ringing' && !activeCallIdRef.current) {
          handleIncomingCall(call)
        }
      })
      .subscribe()

    // Polling fallback: check for ringing calls every 2 seconds
    // This catches calls even if realtime events are missed
    const pollInterval = setInterval(async () => {
      if (activeCallIdRef.current) return
      try {
        const { data: ringingCalls } = await supabase
          .from('calls')
          .select('*')
          .eq('callee_id', user.id)
          .eq('status', 'ringing')
          .order('created_at', { ascending: false })
          .limit(1)
        if (ringingCalls && ringingCalls.length > 0) {
          const call = ringingCalls[0] as Call
          // Double-check it's recent (within last 60 seconds)
          const age = Date.now() - new Date(call.created_at).getTime()
          if (age < 60000) {
            handleIncomingCall(call)
          }
        }
      } catch {}
    }, 2000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollInterval)
    }
  }, [user, handleIncomingCall])

  // Detect incoming group calls: poll for active group calls in chats the user is a member of
  useEffect(() => {
    if (!user) return
    const groupPollInterval = setInterval(async () => {
      if (activeCallIdRef.current) return
      try {
        // Get user's chat memberships
        const { data: memberships } = await supabase
          .from('chat_members')
          .select('chat_id')
          .eq('user_id', user.id)
        if (!memberships || memberships.length === 0) return
        const chatIds = (memberships as any[]).map((m) => m.chat_id)
        // Look for active group calls in those chats
        const { data: groupCalls } = await supabase
          .from('calls')
          .select('*')
          .in('chat_id', chatIds)
          .eq('is_group_call', true)
          .in('status', ['ringing', 'active'])
          .order('created_at', { ascending: false })
          .limit(1)
        if (groupCalls && groupCalls.length > 0) {
          const call = groupCalls[0] as Call
          // Check if we're already a participant
          const { data: myParticipation } = await supabase
            .from('call_participants')
            .select('id')
            .eq('call_id', call.id)
            .eq('user_id', user.id)
            .is('left_at', null)
            .maybeSingle()
          if (!myParticipation) {
            // Check it's recent (within last 60 seconds)
            const age = Date.now() - new Date(call.created_at).getTime()
            if (age < 60000) {
              handleIncomingCall(call)
            }
          }
        }
      } catch {}
    }, 3000)
    return () => clearInterval(groupPollInterval)
  }, [user, handleIncomingCall])

  // Handle join-via-link (?join=<token>) once the user is authenticated
  // Opens a Telegram-style preview: public chats show messages + join button;
  // private chats show a confirmation panel before joining.
  const handleJoinToken = useCallback(async (token: string) => {
    if (!user) return
    setJoinStatus('joining')
    const { data: chatRow, error } = await supabase.rpc('resolve_invite_token', { p_token: token }).maybeSingle()
    if (error || !chatRow) { console.error('resolve_invite_token failed:', error); setJoinStatus('error'); setTimeout(() => setJoinStatus('idle'), 2500); return }
    const chat = chatRow as { id: string; title: string; type: string; is_private: boolean }
    setJoinChatName(chat.title || (chat.type === 'channel' ? 'کانال' : 'گروه'))
    const { data: existing, error: selErr } = await supabase.from('chat_members').select('chat_id').eq('chat_id', chat.id).eq('user_id', user.id).maybeSingle()
    if (selErr) { console.error('member check failed:', selErr) }
    if (existing) {
      setJoinStatus('already')
      setSelectedChatId(chat.id)
      setTimeout(() => setJoinStatus('idle'), 2500)
      return
    }
    setJoinStatus('idle')
    setSelectedChatId('')
    setPreviewChat({ id: chat.id, isPrivate: chat.is_private })
  }, [user])

  useEffect(() => {
    if (!user) return
    const token = getJoinTokenFromUrl()
    if (token) { handleJoinToken(token); clearJoinTokenFromUrl() }
  }, [user, handleJoinToken])

  // Listen for in-app invite link clicks (from chat messages)
  useEffect(() => {
    const handler = (e: Event) => {
      const token = (e as CustomEvent<string>).detail
      if (token) handleJoinToken(token)
    }
    window.addEventListener('app-join-invite', handler as EventListener)
    return () => window.removeEventListener('app-join-invite', handler as EventListener)
  }, [handleJoinToken])

  // Subscribe to push notifications after login (when app is installed/running)
  useEffect(() => {
    if (!user) return
    subscribeToPush(user.id).catch(() => {})
  }, [user])

  // Handle notification click: open the relevant chat
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'open-chat' && event.data.chat_id) {
        setSelectedChatId(event.data.chat_id)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () => navigator.serviceWorker?.removeEventListener('message', handler)
  }, [])

  // Handle ?chat=<id> from notification open (when app was closed)
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search)
    const chatId = params.get('chat')
    if (chatId) {
      setSelectedChatId(chatId)
      const url = new URL(window.location.href)
      url.searchParams.delete('chat')
      window.history.replaceState({}, '', url.toString())
    }
  }, [user])

  const openChatWithUser = useCallback(async (userId: string) => {
    if (!user) return
    const { data: existingMembers } = await supabase.from('chat_members').select('chat_id').eq('user_id', user.id)
    if (existingMembers) {
      for (const m of existingMembers as any[]) {
        const { data: chatData } = await supabase.from('chats').select('type').eq('id', m.chat_id).single()
        if (chatData && chatData.type === 'direct') {
          const { data: otherMember } = await supabase.from('chat_members').select('user_id').eq('chat_id', m.chat_id).neq('user_id', user.id).limit(1)
          if (otherMember && otherMember.length > 0 && otherMember[0].user_id === userId) { setSelectedChatId(m.chat_id); return }
        }
      }
    }
    const { data: chat } = await supabase.from('chats').insert({ type: 'direct', title: null, created_by: user.id }).select().single()
    if (!chat) return
    await supabase.from('chat_members').insert([{ chat_id: chat.id, user_id: user.id, role: 'owner' }, { chat_id: chat.id, user_id: userId, role: 'member' }])
    setSelectedChatId(chat.id)
  }, [user])

  const openChatWithUsername = useCallback(async (username: string) => {
    const { data } = await supabase.from('profiles').select('id').eq('username', username.toLowerCase()).maybeSingle()
    if (data) openChatWithUser((data as any).id)
  }, [openChatWithUser])

  const openChatWithPhone = useCallback(async (phone: string) => {
    const { data } = await supabase.from('profiles').select('id').eq('phone', phone).maybeSingle()
    if (data) openChatWithUser((data as any).id)
  }, [openChatWithUser])

  if (!user || !profile) return <AuthScreen />

  return (
    <div className="h-screen flex overflow-hidden bg-tg-bg">
      <SplashScreen />
      <InstallBanner />
      <div className={`${selectedChatId ? 'hidden md:flex' : 'flex'} w-full md:w-auto`}>
        <ChatList
          selectedId={selectedChatId}
          onSelect={setSelectedChatId}
          onNewChat={() => setShowNewChat(true)}
          onSettings={() => setShowSettings(true)}
          onAdmin={() => setShowAdmin(true)}
          onPreviewChat={(id) => { setPreviewChatId(id); setSelectedChatId('') }}
        />
      </div>
      <div className={`flex-1 relative overflow-hidden ${selectedChatId ? 'flex' : 'hidden md:flex'}`}>
        {selectedChatId ? (
          <ChatView
            key={selectedChatId}
            chatId={selectedChatId}
            onBack={() => setSelectedChatId('')}
            onCall={(callId) => {
              supabase.from('calls').select('*').eq('id', callId).single().then(({ data }) => {
                if (data) {
                  const call = data as Call
                  setCallData(call)
                  setActiveCallId(callId)
                  setCallMinimized(false)
                  if (call.is_group_call) {
                    setGroupCallChatId(call.chat_id)
                    setGroupCallStarter(true)
                  } else if (user) {
                    loadCallInfo(call, user.id)
                  }
                }
              })
            }}
            onShowProfile={setProfileUserId}
            onOpenChatWithUsername={openChatWithUsername}
            onOpenChatWithPhone={openChatWithPhone}
          />
        ) : previewChatId ? (
          <ChatView
            key={`preview-${previewChatId}`}
            chatId={previewChatId}
            previewMode
            onBack={() => setPreviewChatId('')}
            onJoined={(id) => { setPreviewChatId(''); setSelectedChatId(id); window.dispatchEvent(new Event('chat-list-reload')) }}
            onShowProfile={setProfileUserId}
            onOpenChatWithUsername={openChatWithUsername}
            onOpenChatWithPhone={openChatWithPhone}
          />
        ) : previewChat ? (
          <ChatView
            key={`join-${previewChat.id}`}
            chatId={previewChat.id}
            previewMode
            previewPrivate={previewChat.isPrivate}
            onBack={() => setPreviewChat(null)}
            onJoined={(id) => { setPreviewChat(null); setSelectedChatId(id); setJoinStatus('joined'); window.dispatchEvent(new Event('chat-list-reload')); setTimeout(() => setJoinStatus('idle'), 3000) }}
            onShowProfile={setProfileUserId}
            onOpenChatWithUsername={openChatWithUsername}
            onOpenChatWithPhone={openChatWithPhone}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-tg-subtext">
            <MessageCircle size={64} className="mb-4 opacity-30" />
            <p className="text-lg">گفت‌وگویی را انتخاب کنید</p>
          </div>
        )}
      </div>
      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} onChatCreated={(id) => { setSelectedChatId(id); setShowNewChat(false) }} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
      {profileUserId && <ProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />}

      {/* Floating call UI — renders on top of the app, not replacing it */}
      {activeCallId && callData && (
        callData.is_group_call ? (
          <GroupCallModal
            key={activeCallId}
            callId={activeCallId}
            chatId={callData.chat_id}
            isStarter={groupCallStarter}
            minimized={callMinimized}
            onMinimize={() => setCallMinimized(true)}
            onMaximize={() => setCallMinimized(false)}
            onClose={() => { setActiveCallId(null); setCallData(null); setCallMinimized(false); setGroupCallChatId(null); setGroupCallStarter(false) }}
          />
        ) : (
          <CallModal
            call={callData}
            isCaller={callData.caller_id === user.id}
            otherUserName={otherUserName}
            otherUserAvatar={otherUserAvatar}
            minimized={callMinimized}
            onMinimize={() => setCallMinimized(true)}
            onMaximize={() => setCallMinimized(false)}
            onClose={() => { setActiveCallId(null); setCallData(null); setCallMinimized(false) }}
          />
        )
      )}

      {/* Join link toast */}
      {joinStatus !== 'idle' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slideUp">
          <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl ${joinStatus === 'error' ? 'bg-tg-red' : joinStatus === 'joining' ? 'bg-tg-panel border border-tg-hover' : 'bg-tg-green'}`}>
            {joinStatus === 'joining' && <div className="w-5 h-5 border-2 border-tg-accent border-t-transparent rounded-full animate-spin" />}
            {joinStatus === 'joined' && <span className="text-white text-sm">به «{joinChatName}» پیوستید</span>}
            {joinStatus === 'already' && <span className="text-white text-sm">عضو «{joinChatName}» هستید</span>}
            {joinStatus === 'error' && <span className="text-white text-sm">لینک دعوت نامعتبر است</span>}
          </div>
        </div>
      )}
    </div>
  )
}
