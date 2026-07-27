import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { CallParticipant, CallSignal } from '../lib/types'
import { PhoneOff, Mic, MicOff, VideoOff, Video as VideoIcon, Minimize2, Maximize2, Users, Phone } from 'lucide-react'

interface GroupCallModalProps {
  callId: string
  chatId: string
  isStarter: boolean
  onClose: () => void
  minimized?: boolean
  onMinimize?: () => void
  onMaximize?: () => void
}

interface RemotePeer {
  userId: string
  pc: RTCPeerConnection
  stream: MediaStream
  videoEnabled: boolean
  audioEnabled: boolean
  makingOffer: boolean
  remoteDescSet: boolean
  pendingCandidates: any[]
}

interface ProfileCache {
  [userId: string]: { name: string; avatar: string | null }
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
]

export default function GroupCallModal({ callId, chatId, isStarter, onClose, minimized, onMinimize, onMaximize }: GroupCallModalProps) {
  const [status, setStatus] = useState<'connecting' | 'active' | 'ended' | 'incoming'>('connecting')
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [isVideo, setIsVideo] = useState(true)
  const [participants, setParticipants] = useState<CallParticipant[]>([])
  const [profiles, setProfiles] = useState<ProfileCache>({})
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [callAccepted, setCallAccepted] = useState(isStarter)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RemotePeer>>(new Map())
  const myIdRef = useRef<string>('')
  const isVideoRef = useRef(true)
  const cleanupDoneRef = useRef(false)
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const channelRef = useRef<any>(null)
  const participantChannelRef = useRef<any>(null)
  const processedSignalsRef = useRef<Set<string>>(new Set())

  // Load profiles for participants
  const loadProfiles = useCallback(async (userIds: string[]) => {
    if (userIds.length === 0) return
    const missing = userIds.filter((id) => !profiles[id])
    if (missing.length === 0) return
    const { data } = await supabase.from('profiles').select('id, name, avatar_url').in('id', missing)
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev }
        for (const p of data) {
          next[p.id] = { name: p.name || 'کاربر', avatar: p.avatar_url }
        }
        return next
      })
    }
  }, [profiles])

  // Create a peer connection for a specific remote user
  const createPeerConnection = useCallback((remoteUserId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    })

    const peer: RemotePeer = {
      userId: remoteUserId,
      pc,
      stream: new MediaStream(),
      videoEnabled: true,
      audioEnabled: true,
      makingOffer: false,
      remoteDescSet: false,
      pendingCandidates: [],
    }
    peersRef.current.set(remoteUserId, peer)

    // Add local tracks to the peer connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!)
      })
    }

    // Configure max video and audio quality on senders
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind === 'video' && sender.getParameters) {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        if (params.encodings[0]) {
          params.encodings[0].maxBitrate = 2_500_000
          params.encodings[0].maxFramerate = 30
          params.encodings[0].scaleResolutionDownBy = 1
          ;(params.encodings[0] as any).priority = 'high'
          ;(params.encodings[0] as any).networkPriority = 'high'
        }
        sender.setParameters(params).catch(() => {})
      }
      if (sender.track?.kind === 'audio' && sender.getParameters) {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        if (params.encodings[0]) {
          params.encodings[0].maxBitrate = 64_000
          ;(params.encodings[0] as any).priority = 'high'
          ;(params.encodings[0] as any).networkPriority = 'high'
        }
        sender.setParameters(params).catch(() => {})
      }
    }

    pc.ontrack = (event) => {
      peer.stream.addTrack(event.track)
      if (event.track.kind === 'video') {
        const videoEl = remoteVideoRefs.current.get(remoteUserId)
        if (videoEl) {
          videoEl.srcObject = peer.stream
          videoEl.play().catch(() => {})
        }
      } else if (event.track.kind === 'audio') {
        const audioEl = remoteAudioRefs.current.get(remoteUserId)
        if (audioEl) {
          audioEl.srcObject = peer.stream
          audioEl.play().catch(() => {})
        }
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        supabase.from('call_signals').insert({
          call_id: callId,
          from_user: myIdRef.current,
          to_user: remoteUserId,
          type: 'candidate',
          payload: event.candidate.toJSON(),
        }).then()
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setStatus('active')
      }
      if (pc.iceConnectionState === 'failed') {
        // Attempt restart
        pc.restartIce?.()
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('active')
    }

    return pc
  }, [callId])

  // Initiate connection to a new participant.
  // Tie-breaker: the user with the lower ID creates the offer.
  const connectToPeer = useCallback(async (remoteUserId: string) => {
    if (remoteUserId === myIdRef.current) return
    if (peersRef.current.has(remoteUserId)) return

    const pc = createPeerConnection(remoteUserId)
    const peer = peersRef.current.get(remoteUserId)!

    // Lower ID initiates the offer to avoid both sides offering simultaneously
    if (myIdRef.current < remoteUserId) {
      try {
        peer.makingOffer = true
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        peer.makingOffer = false
        await supabase.from('call_signals').insert({
          call_id: callId,
          from_user: myIdRef.current,
          to_user: remoteUserId,
          type: 'offer',
          payload: { sdp: offer.sdp, video: isVideoRef.current },
        })
      } catch (e) {
        peer.makingOffer = false
        console.error('Error creating offer for', remoteUserId, e)
      }
    }
  }, [callId, createPeerConnection])

  // Handle incoming signal
  const handleSignal = useCallback(async (signal: CallSignal) => {
    if (signal.from_user === myIdRef.current) return
    if (processedSignalsRef.current.has(signal.id)) return
    processedSignalsRef.current.add(signal.id)

    let peer = peersRef.current.get(signal.from_user)
    if (!peer && signal.type === 'offer') {
      // Incoming offer from a new peer — create PC and accept
      const pc = createPeerConnection(signal.from_user)
      peer = peersRef.current.get(signal.from_user)!
    }
    if (!peer) return

    const pc = peer.pc

    try {
      if (signal.type === 'offer') {
        // Ignore if we're currently making an offer and have a higher ID
        // (the lower-ID peer's offer wins)
        if (peer.makingOffer && myIdRef.current > signal.from_user) {
          // We have a higher ID, so we should accept their offer instead
          peer.makingOffer = false
        }
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.payload.sdp })
        peer.remoteDescSet = true
        // Process pending candidates
        for (const c of peer.pendingCandidates) {
          try { await pc.addIceCandidate(c) } catch {}
        }
        peer.pendingCandidates = []
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await supabase.from('call_signals').insert({
          call_id: callId,
          from_user: myIdRef.current,
          to_user: signal.from_user,
          type: 'answer',
          payload: { sdp: answer.sdp, video: isVideoRef.current },
        })
      } else if (signal.type === 'answer') {
        if (!peer.remoteDescSet) {
          await pc.setRemoteDescription({ type: 'answer', sdp: signal.payload.sdp })
          peer.remoteDescSet = true
          for (const c of peer.pendingCandidates) {
            try { await pc.addIceCandidate(c) } catch {}
          }
          peer.pendingCandidates = []
        }
      } else if (signal.type === 'candidate') {
        if (peer.remoteDescSet) {
          try { await pc.addIceCandidate(signal.payload) } catch {}
        } else {
          peer.pendingCandidates.push(signal.payload)
        }
      } else if (signal.type === 'renegotiate') {
        // Handle renegotiation for video/audio toggle
        if (myIdRef.current < signal.from_user) {
          const newOffer = await pc.createOffer()
          await pc.setLocalDescription(newOffer)
          await supabase.from('call_signals').insert({
            call_id: callId,
            from_user: myIdRef.current,
            to_user: signal.from_user,
            type: 'offer',
            payload: { sdp: newOffer.sdp, video: isVideoRef.current },
          })
        }
      }
    } catch (e) {
      console.error('Error handling signal:', signal.type, e)
    }
  }, [callId, createPeerConnection])

  // Remove a peer when they leave
  const removePeer = useCallback((remoteUserId: string) => {
    const peer = peersRef.current.get(remoteUserId)
    if (peer) {
      peer.pc.close()
      peersRef.current.delete(remoteUserId)
    }
    setParticipants((prev) => prev.filter((p) => p.user_id !== remoteUserId))
  }, [])

  // Main initialization — only runs after the user accepts/joins
  useEffect(() => {
    if (!callAccepted) return
    if (cleanupDoneRef.current) return
    let cancelled = false

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      myIdRef.current = user.id

      // Get user media — reuse preview stream if available
      let stream: MediaStream
      if (localStreamRef.current && localStreamRef.current.getTracks().length > 0) {
        const hasAudio = localStreamRef.current.getAudioTracks().length > 0
        if (!hasAudio) {
          try {
            const audioStream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              video: false,
            })
            audioStream.getAudioTracks().forEach((t) => localStreamRef.current!.addTrack(t))
          } catch (e) {
            console.error('Failed to get audio:', e)
          }
        }
        stream = localStreamRef.current
      } else {
        try {
          const videoConstraints = isVideoRef.current ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: 'user',
          } : false
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 48000,
              sampleSize: 16,
            },
            video: videoConstraints,
          })
        } catch (e) {
          console.error('Failed to get user media:', e)
          setError('دسترسی به میکروفون/دوربین امکان‌پذیر نیست')
          setStatus('ended')
          return
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }

      // Insert self as participant
      await supabase.from('call_participants').insert({
        call_id: callId,
        user_id: user.id,
        video_enabled: isVideoRef.current,
        audio_enabled: true,
      })

      // If starter, mark call as active
      if (isStarter) {
        await supabase.from('calls').update({ status: 'active' }).eq('id', callId)
      }

      // Load existing participants
      const { data: existingParticipants } = await supabase
        .from('call_participants')
        .select('*')
        .eq('call_id', callId)
        .is('left_at', null)

      if (existingParticipants && !cancelled) {
        const others = (existingParticipants as CallParticipant[]).filter((p) => p.user_id !== user.id)
        setParticipants(existingParticipants as CallParticipant[])
        loadProfiles((existingParticipants as CallParticipant[]).map((p) => p.user_id))
        // Connect to existing participants
        for (const p of others) {
          await connectToPeer(p.user_id)
        }
      }

      // Subscribe to participant changes
      const pChannel = supabase.channel(`group-call-participants-${callId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: `call_id=eq.${callId}` }, (payload: any) => {
          const p = payload.new as CallParticipant
          if (p.user_id === myIdRef.current) return
          setParticipants((prev) => {
            if (prev.find((x) => x.user_id === p.user_id)) return prev
            return [...prev, p]
          })
          loadProfiles([p.user_id])
          connectToPeer(p.user_id)
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_participants', filter: `call_id=eq.${callId}` }, (payload: any) => {
          const p = payload.new as CallParticipant
          if (p.left_at) {
            removePeer(p.user_id)
          } else {
            setParticipants((prev) => prev.map((x) => x.user_id === p.user_id ? p : x))
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'call_participants', filter: `call_id=eq.${callId}` }, (payload: any) => {
          const old = payload.old as any
          if (old.user_id) removePeer(old.user_id)
        })
        .subscribe()
      participantChannelRef.current = pChannel

      // Subscribe to call signals
      const sChannel = supabase.channel(`group-call-signals-${callId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `call_id=eq.${callId}` }, (payload: any) => {
          const signal = payload.new as CallSignal
          if (signal.to_user !== myIdRef.current) return
          handleSignal(signal)
        })
        .subscribe()
      channelRef.current = sChannel

      // Also poll for missed signals (every 2s for first 10s)
      let pollCount = 0
      const signalPoll = setInterval(async () => {
        if (cancelled) { clearInterval(signalPoll); return }
        pollCount++
        if (pollCount > 5) { clearInterval(signalPoll); return }
        const { data: signals } = await supabase
          .from('call_signals')
          .select('*')
          .eq('call_id', callId)
          .eq('to_user', user.id)
          .order('created_at', { ascending: true })
        if (signals) {
          for (const s of signals as CallSignal[]) {
            if (!processedSignalsRef.current.has(s.id)) {
              handleSignal(s)
            }
          }
        }
      }, 2000)

      // Cleanup old signals periodically
      const cleanupInterval = setInterval(async () => {
        if (cancelled) { clearInterval(cleanupInterval); return }
        // Delete signals older than 30 seconds that we've processed
        const thirtySecsAgo = new Date(Date.now() - 30000).toISOString()
        await supabase.from('call_signals')
          .delete()
          .eq('call_id', callId)
          .lt('created_at', thirtySecsAgo)
      }, 10000)

      setStatus('active')
    }

    init()

    return () => {
      cancelled = true
      if (!cleanupDoneRef.current) {
        cleanupDoneRef.current = true
      }
      // Stop local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
        localStreamRef.current = null
      }
      // Close all peer connections
      peersRef.current.forEach((peer) => {
        peer.pc.close()
      })
      peersRef.current.clear()
      // Mark as left
      if (myIdRef.current) {
        supabase.from('call_participants')
          .update({ left_at: new Date().toISOString() })
          .eq('call_id', callId)
          .eq('user_id', myIdRef.current)
          .then()
      }
      // Remove channels
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      if (participantChannelRef.current) supabase.removeChannel(participantChannelRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, isStarter, callAccepted])

  // Re-attach remote streams when video elements mount
  useEffect(() => {
    peersRef.current.forEach((peer, userId) => {
      const videoEl = remoteVideoRefs.current.get(userId)
      const audioEl = remoteAudioRefs.current.get(userId)
      if (videoEl && peer.stream.getVideoTracks().length > 0) {
        videoEl.srcObject = peer.stream
        videoEl.play().catch(() => {})
      }
      if (audioEl && peer.stream.getAudioTracks().length > 0) {
        audioEl.srcObject = peer.stream
        audioEl.play().catch(() => {})
      }
    })
  }, [participants])

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled))
      setMuted(!muted)
      supabase.from('call_participants')
        .update({ audio_enabled: muted })
        .eq('call_id', callId)
        .eq('user_id', myIdRef.current)
        .then()
    }
  }

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks()
      if (videoTracks.length > 0) {
        const newState = !cameraOff
        videoTracks.forEach((t) => (t.enabled = !newState))
        setCameraOff(newState)
        setIsVideo(!newState)
        isVideoRef.current = !newState
        supabase.from('call_participants')
          .update({ video_enabled: !newState })
          .eq('call_id', callId)
          .eq('user_id', myIdRef.current)
          .then()
      }
    }
  }

  const acceptIncoming = async () => {
    // For video calls, show preview first; for audio, join directly
    setShowPreview(true)
    // Start getting user media for preview
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
        audio: false,
      })
      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }
    } catch (e) {
      // If camera fails, join as audio-only
      setShowPreview(false)
      setCallAccepted(true)
    }
  }

  const joinWithVideo = () => {
    setShowPreview(false)
    setCallAccepted(true)
  }

  const leaveCall = async () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    peersRef.current.forEach((peer) => peer.pc.close())
    peersRef.current.clear()
    if (myIdRef.current) {
      await supabase.from('call_participants')
        .update({ left_at: new Date().toISOString() })
        .eq('call_id', callId)
        .eq('user_id', myIdRef.current)
    }
    // Check if any participants remain; if none, end the call
    const { data: remaining } = await supabase
      .from('call_participants')
      .select('id')
      .eq('call_id', callId)
      .is('left_at', null)
    if (!remaining || remaining.length === 0) {
      await supabase.from('calls').update({ status: 'ended' }).eq('id', callId)
    }
    setStatus('ended')
    setTimeout(onClose, 300)
  }

  // Incoming call screen (non-starter, before accepting)
  if (!callAccepted && !isStarter && !showPreview) {
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col items-center justify-center">
        <button onClick={onMinimize} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center text-white transition-colors">
          <Minimize2 size={18} />
        </button>
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-tg-green animate-pulse-ring" />
          <div className="w-32 h-32 rounded-full bg-tg-accent flex items-center justify-center">
            <Users size={56} className="text-white" />
          </div>
        </div>
        <p className="text-tg-text text-xl font-semibold mb-1">تماس گروهی</p>
        <p className="text-tg-subtext text-sm mb-8">در حال ورود به تماس...</p>
        <div className="flex items-center gap-12">
          <button onClick={onClose} className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-tg-red flex items-center justify-center hover:bg-red-600 transition-colors">
              <PhoneOff size={28} className="text-white" />
            </div>
            <span className="text-tg-subtext text-sm">رد</span>
          </button>
          <button onClick={acceptIncoming} className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-tg-green flex items-center justify-center hover:bg-green-600 transition-colors animate-ring">
              <Phone size={28} className="text-white" />
            </div>
            <span className="text-tg-subtext text-sm">قبول</span>
          </button>
        </div>
      </div>
    )
  }

  // Pre-join video preview (after accepting, before connecting)
  if (showPreview && !callAccepted) {
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col">
        <button onClick={onClose} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white z-30 transition-colors">
          <PhoneOff size={18} />
        </button>
        <div className="flex-1 relative overflow-hidden">
          <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60 pointer-events-none" />
        </div>
        <div className="relative z-20 px-4 pb-6 pt-4 bg-tg-panel rounded-t-3xl shadow-2xl">
          <p className="text-tg-text text-base font-medium mb-3 text-center">آماده‌سازی تماس گروهی</p>
          <button onClick={joinWithVideo} className="w-full bg-tg-green hover:bg-green-600 text-white font-medium rounded-2xl py-3.5 flex items-center justify-center gap-2 transition-colors">
            <Phone size={20} />
            <span>ورود به تماس</span>
          </button>
        </div>
      </div>
    )
  }

  if (status === 'ended') {
    if (minimized) return null
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col items-center justify-center">
        <p className="text-tg-text text-lg mb-2">تماس پایان یافت</p>
        <button onClick={onClose} className="bg-tg-hover text-tg-text rounded-xl px-6 py-2">بستن</button>
      </div>
    )
  }

  if (minimized) {
    const activeCount = participants.filter((p) => !p.left_at).length
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-[92vw]">
        <div className="bg-tg-panel rounded-2xl shadow-2xl border border-tg-hover px-3 py-2.5 flex items-center gap-3 min-w-[300px]">
          <div className="w-11 h-11 rounded-full bg-tg-accent/15 flex items-center justify-center flex-shrink-0">
            <Users size={22} className="text-tg-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-tg-text text-sm font-medium truncate">تماس گروهی</p>
            <p className="text-tg-subtext text-xs">
              {activeCount} نفر در تماس {status === 'active' ? '· در حال مکالمه' : '· در حال اتصال...'}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {status === 'active' && (
              <button onClick={toggleMute} className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-tg-red' : 'bg-tg-hover'}`}>
                {muted ? <MicOff size={16} className="text-white" /> : <Mic size={16} className="text-white" />}
              </button>
            )}
            <button onClick={leaveCall} className="w-9 h-9 rounded-full bg-tg-red hover:bg-red-600 flex items-center justify-center transition-colors">
              <PhoneOff size={16} className="text-white" />
            </button>
            <button onClick={onMaximize} className="w-9 h-9 rounded-full bg-tg-hover hover:bg-tg-active flex items-center justify-center transition-colors">
              <Maximize2 size={16} className="text-tg-text" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const activeParticipants = participants.filter((p) => !p.left_at)
  const totalTiles = activeParticipants.length + 1 // +1 for self

  // Grid layout: 1-2 tiles = 1 column, 3-4 = 2 cols, 5-6 = 3 cols, 7+ = 3 cols
  const gridCols = totalTiles <= 2 ? 1 : totalTiles <= 4 ? 2 : 3

  return (
    <div className="fixed inset-0 bg-black z-[90] flex flex-col">
      {/* Hidden audio elements for remote peers */}
      {activeParticipants.map((p) => (
        <audio key={`audio-${p.user_id}`} ref={(el) => { if (el) remoteAudioRefs.current.set(p.user_id, el) }} autoPlay playsInline className="hidden" />
      ))}

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-2 text-white">
          <Users size={18} />
          <span className="text-sm font-medium">تماس گروهی · {activeParticipants.length + 1} نفر</span>
        </div>
        <button onClick={onMinimize} className="w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white transition-colors">
          <Minimize2 size={18} />
        </button>
      </div>

      {/* Video grid */}
      <div className={`flex-1 grid gap-1 p-1 ${gridCols === 1 ? 'grid-cols-1' : gridCols === 2 ? 'grid-cols-2' : 'grid-cols-3'} grid-rows-auto`} style={{ gridAutoRows: '1fr' }}>
        {/* Local video tile */}
        <div className="relative bg-tg-panel rounded-lg overflow-hidden flex items-center justify-center">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraOff ? 'hidden' : ''}`}
          />
          {cameraOff && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-tg-accent flex items-center justify-center text-2xl text-white font-semibold">
                {profiles[myIdRef.current]?.name?.charAt(0) || 'ش'}
              </div>
            </div>
          )}
          <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-2 py-1 bg-black/50 rounded">
            <span className="text-white text-xs font-medium">شما</span>
            {muted && <MicOff size={12} className="text-tg-red" />}
          </div>
        </div>

        {/* Remote participant tiles */}
        {activeParticipants.map((p) => {
          const profile = profiles[p.user_id]
          const peer = peersRef.current.get(p.user_id)
          const hasVideo = (peer?.stream.getVideoTracks().length ?? 0) > 0 && p.video_enabled
          return (
            <div key={p.user_id} className="relative bg-tg-panel rounded-lg overflow-hidden flex items-center justify-center">
              <video
                ref={(el) => { if (el) remoteVideoRefs.current.set(p.user_id, el) }}
                autoPlay
                playsInline
                className={`w-full h-full object-cover ${hasVideo ? '' : 'hidden'}`}
              />
              {!hasVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-tg-accent">
                    {profile?.avatar ? (
                      <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-tg-accent flex items-center justify-center text-2xl text-white font-semibold">
                        {profile?.name?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between px-2 py-1 bg-black/50 rounded">
                <span className="text-white text-xs font-medium truncate">{profile?.name || '...'}</span>
                {!p.audio_enabled && <MicOff size={12} className="text-tg-red flex-shrink-0" />}
              </div>
            </div>
          )
        })}
      </div>

      {/* Controls */}
      <div className="pb-8 pt-4 flex items-center justify-center gap-3 bg-gradient-to-t from-black/80 to-transparent relative z-20">
        <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-tg-red' : 'bg-tg-hover'}`}>
          {muted ? <MicOff size={20} className="text-white" /> : <Mic size={20} className="text-white" />}
        </button>
        <button onClick={toggleCamera} className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${cameraOff ? 'bg-tg-red' : 'bg-tg-hover'}`}>
          {cameraOff ? <VideoOff size={20} className="text-white" /> : <VideoIcon size={20} className="text-white" />}
        </button>
        <button onClick={leaveCall} className="w-14 h-14 rounded-full bg-tg-red flex items-center justify-center hover:bg-red-600 transition-colors">
          <PhoneOff size={24} className="text-white" />
        </button>
      </div>

      {error && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-tg-red text-white text-sm px-4 py-2 rounded-lg z-30">
          {error}
        </div>
      )}
    </div>
  )
}
