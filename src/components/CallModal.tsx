import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Call } from '../lib/types'
import { BackgroundProcessor, BackgroundConfig, BackgroundMode } from '../lib/backgroundEffect'
import { PhoneOff, Mic, MicOff, VideoOff, Video as VideoIcon, Phone, X, Maximize2, Minimize2, Volume2, Sparkles, Image as ImageIcon, Palette, Eye, Check, Loader2 } from 'lucide-react'

interface CallModalProps {
  call: Call
  isCaller: boolean
  onClose: () => void
  otherUserName: string
  otherUserAvatar: string | null
  minimized?: boolean
  onMinimize?: () => void
  onMaximize?: () => void
}

// setSinkId is non-standard but supported in Chromium browsers
type HTMLAudioElementWithSink = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>
  sinkId?: string
}

export default function CallModal({ call, isCaller, onClose, otherUserName, otherUserAvatar, minimized, onMinimize, onMaximize }: CallModalProps) {
  const [status, setStatus] = useState(call.status)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [connected, setConnected] = useState(false)
  const [callStarted, setCallStarted] = useState(false)
  const [showPreview, setShowPreview] = useState(isCaller && call.video)
  const [isVideo, setIsVideo] = useState(call.video)
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([])
  const [selectedOutput, setSelectedOutput] = useState<string>('')
  const [bgPanelOpen, setBgPanelOpen] = useState(false)
  const [bgConfig, setBgConfig] = useState<BackgroundConfig>({ mode: 'none' })
  const [incomingSwitch, setIncomingSwitch] = useState<{ to_video: boolean } | null>(null)
  const [outgoingSwitch, setOutgoingSwitch] = useState(false)
  const [switchRejected, setSwitchRejected] = useState(false)

  const myId = isCaller ? call.caller_id : call.callee_id
  const otherUserId = isCaller ? call.callee_id : call.caller_id

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElementWithSink>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const rawStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const bgProcessorRef = useRef<BackgroundProcessor | null>(null)
  const remoteDescSetRef = useRef(false)
  const pendingCandidatesRef = useRef<any[]>([])
  const processedCandidateIdsRef = useRef<Set<string>>(new Set())
  const channelRef = useRef<any>(null)
  const isVideoRef = useRef(call.video)
  const offerVersionRef = useRef(0)
  const processedAnswerVersionRef = useRef(0)
  const renegotiationPendingRef = useRef(false)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const previewStreamRef = useRef<MediaStream | null>(null)
  const previewProcessorRef = useRef<BackgroundProcessor | null>(null)

  useEffect(() => { isVideoRef.current = isVideo }, [isVideo])

  // For audio calls there is no pre-join preview, so the caller must start
  // the peer connection immediately. For video calls the caller goes through
  // the preview screen first and starts via startCall().
  useEffect(() => {
    if (isCaller && !isVideo && !callStarted) {
      setCallStarted(true)
    }
  }, [isCaller, isVideo, callStarted])

  const configureVideoQuality = (pc: RTCPeerConnection) => {
    const senders = pc.getSenders()
    for (const sender of senders) {
      if (sender.track?.kind === 'video' && sender.getParameters) {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        if (params.encodings[0]) {
          params.encodings[0].maxBitrate = 2_500_000
          params.encodings[0].maxFramerate = 30
          params.encodings[0].scaleResolutionDownBy = 1
          ;(params.encodings[0] as any).priority = 'high'
          ;(params.encodings[0] as any).networkPriority = 'high'
        }
        sender.setParameters(params).catch((e) => console.error('setParameters error:', e))
      }
      if (sender.track?.kind === 'audio' && sender.getParameters) {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        if (params.encodings[0]) {
          params.encodings[0].maxBitrate = 64_000
          ;(params.encodings[0] as any).priority = 'high'
          ;(params.encodings[0] as any).networkPriority = 'high'
        }
        sender.setParameters(params).catch((e) => console.error('audio setParameters error:', e))
      }
    }
    // Prefer H264 for reliable hardware-accelerated encoding, then VP8, VP9 last
    try {
      const caps = RTCRtpSender.getCapabilities('video')
      if (caps) {
        const preferred = ['H264', 'VP8', 'VP9']
        const codecs = [...caps.codecs]
        codecs.sort((a, b) => {
          const ai = preferred.indexOf(a.mimeType.split('/')[1].toUpperCase())
          const bi = preferred.indexOf(b.mimeType.split('/')[1].toUpperCase())
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })
        for (const sender of senders) {
          if (sender.track?.kind === 'video') {
          (sender as any).setCodecPreferences?.(codecs)
          }
        }
      }
    } catch (e) { console.error('Codec preference error:', e) }
  }

  const applyRemoteDescription = useCallback(async (pc: RTCPeerConnection, sdp: string, type: 'offer' | 'answer') => {
    if (remoteDescSetRef.current && type === 'offer') {
      // renegotiation: set remote description for new offer
      try {
        await pc.setRemoteDescription({ type, sdp })
        for (const c of pendingCandidatesRef.current) {
          try { await pc.addIceCandidate(c) } catch {}
        }
        pendingCandidatesRef.current = []
      } catch (e) {
        console.error('Error setting remote description (renegotiation):', e)
      }
      return
    }
    if (remoteDescSetRef.current) return
    try {
      await pc.setRemoteDescription({ type, sdp })
      remoteDescSetRef.current = true
      for (const c of pendingCandidatesRef.current) {
        try { await pc.addIceCandidate(c) } catch {}
      }
      pendingCandidatesRef.current = []
    } catch (e) {
      console.error('Error setting remote description:', e)
    }
  }, [])

  const processNewCandidates = useCallback(async () => {
    const otherId = isCaller ? call.callee_id : call.caller_id
    const { data: candidates } = await supabase
      .from('call_candidates')
      .select('*')
      .eq('call_id', call.id)
      .eq('user_id', otherId)
      .order('created_at', { ascending: true })
    if (!candidates) return
    for (const c of candidates as any[]) {
      if (processedCandidateIdsRef.current.has(c.id)) continue
      processedCandidateIdsRef.current.add(c.id)
      if (remoteDescSetRef.current && pcRef.current) {
        try { await pcRef.current.addIceCandidate(c.candidate) } catch {}
      } else {
        pendingCandidatesRef.current.push(c.candidate)
      }
    }
  }, [call.id, call.caller_id, call.callee_id, isCaller])

  // Enumerate audio output devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const outputs = devices.filter((d) => d.kind === 'audiooutput')
        setAudioOutputs(outputs)
        if (outputs.length > 0 && !selectedOutput) {
          setSelectedOutput(outputs[0].deviceId || 'default')
        }
      } catch {}
    }
    loadDevices()
    navigator.mediaDevices.addEventListener?.('devicechange', loadDevices)
    return () => { navigator.mediaDevices.removeEventListener?.('devicechange', loadDevices) }
  }, [selectedOutput])

  // Apply selected audio output to remote audio element
  useEffect(() => {
    if (remoteAudioRef.current && remoteAudioRef.current.setSinkId && selectedOutput) {
      remoteAudioRef.current.setSinkId(selectedOutput).catch(() => {})
    }
  }, [selectedOutput, connected])

  useEffect(() => {
    if (!callStarted) return

    let cancelled = false
    let pollInterval: any = null
    let candidateInterval: any = null
    let statusInterval: any = null
    let localPc: RTCPeerConnection | null = null
    let localStream: MediaStream | null = null
    let localChannel: any = null

    const init = async () => {
      let pc: RTCPeerConnection
      let stream: MediaStream
      try {
        pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
          ],
          bundlePolicy: 'max-bundle',
          iceTransportPolicy: 'all',
          iceCandidatePoolSize: 10,
        })
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
        console.error('Failed to setup peer connection:', e)
        setStatus('ended')
        return
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        pc.close()
        return
      }

      localPc = pc
      localStream = stream
      pcRef.current = pc
      localStreamRef.current = stream
      rawStreamRef.current = stream

      // Try to setup background processor for video calls so the peer
      // receives the processed (background-replaced) track. If it fails
      // (e.g. MediaPipe CDN blocked), fall back to the raw camera stream
      // so the call still works.
      if (isVideoRef.current) {
        await setupBackgroundProcessor(stream)
      }

      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
      // Add tracks from the stream we actually send (processed video + raw audio)
      localStreamRef.current!.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!))

      // Configure high-quality video encoding: prefer H264, set bitrate caps
      configureVideoQuality(pc)

      pc.ontrack = (event) => {
        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()
        remoteStreamRef.current.addTrack(event.track)
        if (event.track.kind === 'video' && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current
          remoteVideoRef.current.play().catch(() => {})
        } else if (event.track.kind === 'audio' && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStreamRef.current
          remoteAudioRef.current.play().catch(() => {})
        }
        setConnected(true)
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const myId = isCaller ? call.caller_id : call.callee_id
          supabase.from('call_candidates').insert({
            call_id: call.id,
            user_id: myId,
            candidate: event.candidate.toJSON(),
          }).then()
        }
      }

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setConnected(true)
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setConnected(true)
      }

      const channel = supabase.channel(`call-${call.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${call.id}` }, async (payload: any) => {
          const updated = payload.new as Call
          if (updated.status === 'ended' || updated.status === 'rejected') {
            setStatus(updated.status)
            return
          }
          if (updated.status === 'accepted') {
            setStatus('accepted')
          }
          // Handle call-type switch request/response
          if (updated.switch_request) {
            const req = updated.switch_request
            if (req.status === 'pending' && req.requested_by !== myId) {
              setIncomingSwitch({ to_video: req.to_video })
            } else if (req.status === 'accepted' && req.requested_by === myId) {
              setOutgoingSwitch(false)
              if (req.to_video) {
                await upgradeToVideo(pc)
              } else {
                downgradeToAudio(pc)
              }
              try {
                const newOffer = await pc.createOffer()
                await pc.setLocalDescription(newOffer)
                offerVersionRef.current += 1
                await supabase.from('calls').update({
                  offer_sdp: newOffer.sdp,
                  offer_version: offerVersionRef.current,
                  video: req.to_video,
                  switch_request: null,
                }).eq('id', call.id)
              } catch (e) { console.error('switch renegotiation error:', e) }
            } else if (req.status === 'rejected' && req.requested_by === myId) {
              setOutgoingSwitch(false)
              setSwitchRejected(true)
              setTimeout(() => setSwitchRejected(false), 3000)
              await supabase.from('calls').update({ switch_request: null }).eq('id', call.id)
            }
          } else {
            setIncomingSwitch(null)
          }
          // Handle renegotiation: new offer from the other side
          if (updated.offer_sdp && updated.offer_version !== undefined && updated.offer_version > offerVersionRef.current) {
            offerVersionRef.current = updated.offer_version
            const needsMediaChange = isVideoRef.current !== updated.video
            if (needsMediaChange) {
              setIsVideo(updated.video)
              isVideoRef.current = updated.video
            }
            await applyRemoteDescription(pc, updated.offer_sdp, 'offer')
            if (needsMediaChange) {
              if (updated.video) {
                await upgradeToVideo(pc)
              } else {
                downgradeToAudio(pc)
              }
            }
            try {
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              await supabase.from('calls').update({ answer_sdp: answer.sdp, status: 'accepted' }).eq('id', call.id)
            } catch (e) { console.error('Error creating renegotiation answer:', e) }
          }
          if (!isCaller && updated.offer_sdp && !remoteDescSetRef.current) {
            await applyRemoteDescription(pc, updated.offer_sdp, 'offer')
            try {
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              await supabase.from('calls').update({ answer_sdp: answer.sdp, status: 'accepted' }).eq('id', call.id)
            } catch (e) { console.error('Error creating answer:', e) }
          }
          if (isCaller && updated.answer_sdp) {
            if (!remoteDescSetRef.current) {
              await applyRemoteDescription(pc, updated.answer_sdp, 'answer')
              processedAnswerVersionRef.current = updated.offer_version || 0
            } else if ((updated.offer_version || 0) > processedAnswerVersionRef.current) {
              processedAnswerVersionRef.current = updated.offer_version || 0
              try {
                await pc.setRemoteDescription({ type: 'answer', sdp: updated.answer_sdp })
              } catch (e) { console.error('Error setting renegotiation answer:', e) }
            }
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_candidates', filter: `call_id=eq.${call.id}` }, async (payload: any) => {
          const row = payload.new
          const myId = isCaller ? call.caller_id : call.callee_id
          if (row.user_id === myId) return
          if (processedCandidateIdsRef.current.has(row.id)) return
          processedCandidateIdsRef.current.add(row.id)
          if (remoteDescSetRef.current && pcRef.current) {
            try { await pcRef.current.addIceCandidate(row.candidate) } catch {}
          } else {
            pendingCandidatesRef.current.push(row.candidate)
          }
        })
        .subscribe()
      localChannel = channel
      channelRef.current = channel

      if (isCaller) {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          await supabase.from('calls').update({ offer_sdp: offer.sdp }).eq('id', call.id)
        } catch (e) { console.error('Error creating offer:', e) }

        let pollCount = 0
        pollInterval = setInterval(async () => {
          if (cancelled) { clearInterval(pollInterval); return }
          pollCount++
          if (remoteDescSetRef.current || pollCount > 240) { clearInterval(pollInterval); return }
          const { data: callRow } = await supabase.from('calls').select('answer_sdp, status').eq('id', call.id).single()
          if (callRow) {
            const c = callRow as any
            if (c.status === 'ended' || c.status === 'rejected') {
              setStatus(c.status); clearInterval(pollInterval); return
            }
            if (c.status === 'accepted') {
              setStatus('accepted')
            }
            if (c.answer_sdp && !remoteDescSetRef.current) {
              await applyRemoteDescription(pc, c.answer_sdp, 'answer')
            }
          }
        }, 250)
      }

      if (!isCaller) {
        const checkOffer = async (): Promise<boolean> => {
          if (remoteDescSetRef.current || cancelled) return false
          const { data: callRow } = await supabase.from('calls').select('offer_sdp, status').eq('id', call.id).single()
          if (callRow) {
            const c = callRow as any
            if (c.status === 'ended' || c.status === 'rejected') {
              setStatus(c.status); return true
            }
            if (c.offer_sdp && !remoteDescSetRef.current) {
              await applyRemoteDescription(pc, c.offer_sdp, 'offer')
              try {
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await supabase.from('calls').update({ answer_sdp: answer.sdp, status: 'accepted' }).eq('id', call.id)
              } catch (e) { console.error('Error creating answer (poll):', e) }
              return true
            }
          }
          return false
        }
        await checkOffer()
        let pollCount = 0
        pollInterval = setInterval(async () => {
          if (cancelled) { clearInterval(pollInterval); return }
          pollCount++
          if (remoteDescSetRef.current || pollCount > 240) { clearInterval(pollInterval); return }
          await checkOffer()
        }, 250)
      }

      await processNewCandidates()
      candidateInterval = setInterval(async () => {
        if (cancelled) { clearInterval(candidateInterval); return }
        await processNewCandidates()
      }, 250)

      statusInterval = setInterval(async () => {
        if (cancelled) { clearInterval(statusInterval); return }
        const { data: callRow } = await supabase.from('calls').select('status').eq('id', call.id).single()
        if (callRow) {
          const s = (callRow as any).status
          if (s === 'ended' || s === 'rejected') {
            setStatus(s); clearInterval(statusInterval)
          }
        }
      }, 1000)
    }

    init()

    return () => {
      cancelled = true
      if (pollInterval) clearInterval(pollInterval)
      if (candidateInterval) clearInterval(candidateInterval)
      if (statusInterval) clearInterval(statusInterval)
      if (localStream) localStream.getTracks().forEach((t) => t.stop())
      if (bgProcessorRef.current) { bgProcessorRef.current.dispose(); bgProcessorRef.current = null }
      if (localPc) localPc.close()
      if (localChannel) {
        supabase.removeChannel(localChannel)
      }
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      if (pcRef.current === localPc) pcRef.current = null
      if (localStreamRef.current === localStream) localStreamRef.current = null
      if (rawStreamRef.current === localStream) rawStreamRef.current = null
      if (channelRef.current === localChannel) channelRef.current = null
    }
  }, [callStarted, isCaller, call.id, call.caller_id, call.callee_id, applyRemoteDescription, processNewCandidates])

  useEffect(() => {
    const channel = supabase.channel(`call-status-${call.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${call.id}` }, (payload: any) => {
        const updated = payload.new as Call
        if (updated.status === 'ended' || updated.status === 'rejected') {
          setStatus(updated.status)
        } else if (updated.status === 'accepted') {
          setStatus('accepted')
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [call.id])

  useEffect(() => {
    if (localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current
      localVideoRef.current.play().catch(() => {})
    }
    if (remoteStreamRef.current && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current
      remoteVideoRef.current.play().catch((e) => console.error('remote video play error', e))
    }
    if (remoteStreamRef.current && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current
      remoteAudioRef.current.play().catch((e) => console.error('remote audio play error', e))
    }
  }, [minimized, connected, isVideo])

  useEffect(() => {
    if (status === 'ended' || status === 'rejected') {
      if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null }
      if (rawStreamRef.current) { rawStreamRef.current.getTracks().forEach((t) => t.stop()); rawStreamRef.current = null }
      if (previewStreamRef.current) { previewStreamRef.current.getTracks().forEach((t) => t.stop()); previewStreamRef.current = null }
      if (bgProcessorRef.current) { bgProcessorRef.current.dispose(); bgProcessorRef.current = null }
      if (previewProcessorRef.current) { previewProcessorRef.current.dispose(); previewProcessorRef.current = null }
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      if (localVideoRef.current) localVideoRef.current.srcObject = null
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    }
  }, [status])

  useEffect(() => {
    if ((status === 'ended' || status === 'rejected') && minimized) {
      onClose()
    }
  }, [status, minimized, onClose])

  // Background processor setup — combines the processed video track with the
  // raw audio track into one MediaStream that is both previewed locally and
  // sent over the peer connection. This is what makes background effects
  // visible to the other person.
  const setupBackgroundProcessor = async (stream: MediaStream) => {
    if (bgProcessorRef.current) bgProcessorRef.current.dispose()
    // Show raw camera in self-view immediately
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    let processor: BackgroundProcessor
    try {
      processor = await BackgroundProcessor.create()
    } catch (e) {
      console.error('Failed to load background processor, using raw stream:', e)
      localStreamRef.current = stream
      return
    }
    await processor.setInputStream(stream)
    processor.setConfig(bgConfig)
    let switchedToProcessed = false
    processor.onFirstFrame = () => {
      if (!switchedToProcessed && bgProcessorRef.current === processor) {
        switchedToProcessed = true
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
      }
    }
    processor.onInitFailed = (e) => {
      console.error('Background processor init failed, using raw stream:', e)
      if (bgProcessorRef.current === processor) {
        processor.dispose()
        bgProcessorRef.current = null
        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        const pc = pcRef.current
        if (pc) {
          const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video')
          if (videoSender) {
            const rawVideoTrack = stream.getVideoTracks()[0]
            if (rawVideoTrack) videoSender.replaceTrack(rawVideoTrack)
          }
        }
      }
    }
    processor.start()
    bgProcessorRef.current = processor
    const processedVideoStream = processor.getOutputStream()
    // Merge processed video tracks + raw audio tracks into one send stream
    const sendStream = new MediaStream()
    processedVideoStream.getVideoTracks().forEach((t) => sendStream.addTrack(t))
    stream.getAudioTracks().forEach((t) => sendStream.addTrack(t))
    localStreamRef.current = sendStream
  }

  // Apply background config changes live (both in-call and preview)
  useEffect(() => {
    if (bgProcessorRef.current) {
      bgProcessorRef.current.setConfig(bgConfig)
    }
    if (previewProcessorRef.current) {
      previewProcessorRef.current.setConfig(bgConfig)
    }
  }, [bgConfig])

  // Pre-join camera preview with background effects
  useEffect(() => {
    if (!showPreview) return
    let cancelled = false
    const initPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        previewStreamRef.current = stream
        // Show raw camera immediately so the user sees themselves right away
        if (previewVideoRef.current) previewVideoRef.current.srcObject = stream
        let processor: BackgroundProcessor
        try {
          processor = await BackgroundProcessor.create()
        } catch (e) {
          console.error('Preview background processor load failed, using raw stream:', e)
          return
        }
        await processor.setInputStream(stream)
        processor.setConfig(bgConfig)
        let switchedToProcessed = false
        processor.onInitFailed = (e) => {
          console.error('Preview background processor failed, using raw stream:', e)
          if (previewProcessorRef.current === processor) {
            processor.dispose()
            previewProcessorRef.current = null
            if (previewVideoRef.current) previewVideoRef.current.srcObject = stream
          }
        }
        // Switch to processed stream once first frame is ready
        processor.onFirstFrame = () => {
          if (!switchedToProcessed && previewProcessorRef.current === processor && !cancelled) {
            switchedToProcessed = true
            if (previewVideoRef.current) previewVideoRef.current.srcObject = processor.getOutputStream()
          }
        }
        processor.start()
        previewProcessorRef.current = processor
      } catch (e) {
        console.error('Preview camera error:', e)
      }
    }
    initPreview()
    return () => {
      cancelled = true
      if (previewProcessorRef.current) { previewProcessorRef.current.dispose(); previewProcessorRef.current = null }
      if (previewStreamRef.current) { previewStreamRef.current.getTracks().forEach((t) => t.stop()); previewStreamRef.current = null }
    }
  }, [showPreview])

  // Upgrade audio call to video call
  const upgradeToVideo = async (pc: RTCPeerConnection) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
        audio: false,
      })
      rawStreamRef.current = newStream
      // setupBackgroundProcessor merges processed video with audio from the
      // given stream, but newStream is video-only. So we need to keep the
      // existing audio track from the previous raw stream.
      const existingAudio = localStreamRef.current?.getAudioTracks() || []
      const mergeStream = new MediaStream()
      newStream.getVideoTracks().forEach((t) => mergeStream.addTrack(t))
      existingAudio.forEach((t) => mergeStream.addTrack(t))
      await setupBackgroundProcessor(mergeStream)
      const processedVideoTrack = localStreamRef.current!.getVideoTracks()[0]
      const videoTransceiver = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video')
      if (videoTransceiver) {
        await videoTransceiver.sender.replaceTrack(processedVideoTrack)
        videoTransceiver.direction = 'sendrecv'
      } else {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) {
          await sender.replaceTrack(processedVideoTrack)
        } else {
          pc.addTrack(processedVideoTrack, localStreamRef.current!)
        }
      }
      setIsVideo(true)
      isVideoRef.current = true
      setCameraOff(false)
    } catch (e) {
      console.error('upgradeToVideo error:', e)
      setError('دسترسی به دوربین امکان‌پذیر نیست')
    }
  }

  // Downgrade video call to audio call
  const downgradeToAudio = (pc: RTCPeerConnection) => {
    if (bgProcessorRef.current) { bgProcessorRef.current.dispose(); bgProcessorRef.current = null }
    const videoTrack = rawStreamRef.current?.getVideoTracks()[0]
    if (videoTrack) videoTrack.stop()
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (sender) sender.replaceTrack(null)
    setIsVideo(false)
    isVideoRef.current = false
    setCameraOff(false)
  }

  // Request to switch call type — asks the other participant first.
  // The media change + renegotiation only happens after they accept.
  const requestSwitchType = async (toVideo: boolean) => {
    if (!connected || toVideo === isVideo || outgoingSwitch || incomingSwitch) return
    setOutgoingSwitch(true)
    await supabase.from('calls').update({
      switch_request: { to_video: toVideo, requested_by: myId, status: 'pending' },
    }).eq('id', call.id)
  }

  const cancelSwitchRequest = async () => {
    setOutgoingSwitch(false)
    await supabase.from('calls').update({ switch_request: null }).eq('id', call.id)
  }

  // Respond to an incoming switch request from the other participant.
  const respondToSwitch = async (accept: boolean) => {
    const toVideo = incomingSwitch?.to_video ?? false
    setIncomingSwitch(null)
    await supabase.from('calls').update({
      switch_request: { to_video: toVideo, requested_by: otherUserId, status: accept ? 'accepted' : 'rejected' },
    }).eq('id', call.id)
  }

  const [error, setError] = useState<string | null>(null)

  const endCall = async () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop())
    if (rawStreamRef.current) rawStreamRef.current.getTracks().forEach((t) => t.stop())
    if (bgProcessorRef.current) { bgProcessorRef.current.dispose(); bgProcessorRef.current = null }
    if (pcRef.current) pcRef.current.close()
    await supabase.from('calls').update({ status: 'ended' }).eq('id', call.id)
    setStatus('ended')
    setTimeout(onClose, 500)
  }

  const rejectCall = async () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop())
    if (pcRef.current) pcRef.current.close()
    await supabase.from('calls').update({ status: 'rejected' }).eq('id', call.id)
    setStatus('rejected')
    setTimeout(onClose, 500)
  }

  const acceptCall = async () => {
    await supabase.from('calls').update({ status: 'accepted' }).eq('id', call.id)
    setStatus('accepted')
    if (isVideo) {
      setShowPreview(true)
    } else {
      setCallStarted(true)
    }
  }

  const cancelPreview = async () => {
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null }
    if (rawStreamRef.current) { rawStreamRef.current.getTracks().forEach((t) => t.stop()); rawStreamRef.current = null }
    if (previewStreamRef.current) { previewStreamRef.current.getTracks().forEach((t) => t.stop()); previewStreamRef.current = null }
    if (bgProcessorRef.current) { bgProcessorRef.current.dispose(); bgProcessorRef.current = null }
    if (previewProcessorRef.current) { previewProcessorRef.current.dispose(); previewProcessorRef.current = null }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null
    await supabase.from('calls').update({ status: 'ended' }).eq('id', call.id)
    onClose()
  }

  const startCall = () => {
    setShowPreview(false)
    setCallStarted(true)
  }

  const joinCall = () => {
    setShowPreview(false)
    setCallStarted(true)
  }

  const toggleMute = () => {
    if (rawStreamRef.current) {
      rawStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled))
      setMuted(!muted)
    }
  }
  const toggleCamera = () => {
    const videoTracks = rawStreamRef.current?.getVideoTracks() || []
    if (videoTracks.length > 0) {
      const newState = !cameraOff
      videoTracks.forEach((t) => (t.enabled = !newState))
      setCameraOff(newState)
      // When camera is off, tell the processor to draw a black frame
      if (bgProcessorRef.current) {
        bgProcessorRef.current.setCameraEnabled(!newState)
      }
    }
  }

  const changeAudioOutput = (deviceId: string) => {
    setSelectedOutput(deviceId)
    if (remoteAudioRef.current && remoteAudioRef.current.setSinkId) {
      remoteAudioRef.current.setSinkId(deviceId).catch(() => {})
    }
  }

  const backgroundPresets: { mode: BackgroundMode; label: string; color?: string; imageUrl?: string }[] = [
    { mode: 'none', label: 'بدون افکت' },
    { mode: 'blur', label: 'محو' },
    { mode: 'color', label: 'ساده', color: '#1e293b' },
    { mode: 'color', label: 'آبی', color: '#1e3a8a' },
    { mode: 'color', label: 'سبز', color: '#14532d' },
    { mode: 'image', label: 'دفتر', imageUrl: 'https://images.pexels.com/photos/1763135/pexels-photo-1763135.jpeg?auto=compress&cs=tinysrgb&w=1280' },
    { mode: 'image', label: 'ساحل', imageUrl: 'https://images.pexels.com/photos/1504578/pexels-photo-1504578.jpeg?auto=compress&cs=tinysrgb&w=1280' },
  ]

  if (status === 'rejected' || status === 'ended') {
    if (minimized) return null
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col items-center justify-center">
        <p className="text-tg-text text-lg mb-2">{status === 'rejected' ? 'تماس رد شد' : 'تماس پایان یافت'}</p>
        <button onClick={onClose} className="bg-tg-hover text-tg-text rounded-xl px-6 py-2">بستن</button>
      </div>
    )
  }

  if (minimized) {
    const isIncoming = !isCaller && !callStarted && !showPreview
    const isPreview = showPreview && !callStarted
    const isRinging = isCaller && status === 'ringing' && !connected && !showPreview
    const isActive = connected || (status === 'accepted' && callStarted)
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-full max-w-[92vw]">
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        <div className="bg-tg-panel rounded-2xl shadow-2xl border border-tg-hover px-3 py-2.5 flex items-center gap-3 min-w-[300px] max-w-[92vw] w-full">
          <div className="relative flex-shrink-0">
            <div className="w-11 h-11 rounded-full overflow-hidden">
              {otherUserAvatar ? (
                <img src={otherUserAvatar} alt={otherUserName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-tg-accent flex items-center justify-center text-lg text-white font-semibold">
                  {otherUserName?.charAt(0) || '?'}
                </div>
              )}
            </div>
            {isIncoming && <div className="absolute -inset-1 rounded-full border-2 border-tg-green animate-pulse" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-tg-text text-sm font-medium truncate">{otherUserName}</p>
            <p className="text-tg-subtext text-xs">
              {isPreview ? (isCaller ? 'آماده‌سازی تماس' : 'آماده‌سازی ورود') : isIncoming ? (isVideo ? 'تماس تصویری ورودی' : 'تماس صوتی ورودی') : isRinging ? 'در حال زنگ خوردن...' : isActive ? 'در حال مکالمه' : 'در حال اتصال...'}
            </p>
          </div>
          {isIncoming ? (
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={rejectCall} className="w-9 h-9 rounded-full bg-tg-red hover:bg-red-600 flex items-center justify-center transition-colors">
                <X size={16} className="text-white" />
              </button>
              <button onClick={acceptCall} className="w-9 h-9 rounded-full bg-tg-green hover:bg-green-600 flex items-center justify-center transition-colors animate-ring">
                <Phone size={16} className="text-white" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 flex-shrink-0">
              {isActive && (
                <button onClick={toggleMute} className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-tg-red' : 'bg-tg-hover'}`}>
                  {muted ? <MicOff size={16} className="text-white" /> : <Mic size={16} className="text-white" />}
                </button>
              )}
              <button onClick={endCall} className="w-9 h-9 rounded-full bg-tg-red hover:bg-red-600 flex items-center justify-center transition-colors">
                <PhoneOff size={16} className="text-white" />
              </button>
              <button onClick={onMaximize} className="w-9 h-9 rounded-full bg-tg-hover hover:bg-tg-active flex items-center justify-center transition-colors">
                <Maximize2 size={16} className="text-tg-text" />
              </button>
            </div>
          )}
        </div>
        {outgoingSwitch && (
          <div className="bg-tg-panel border border-tg-hover rounded-2xl shadow-2xl px-3 py-2 flex items-center gap-2.5 min-w-[300px] max-w-[92vw] w-full">
            <Loader2 size={14} className="text-tg-accent animate-spin flex-shrink-0" />
            <span className="text-tg-text text-xs flex-1 truncate">در انتظار پاسخ برای تغییر نوع تماس...</span>
            <button onClick={cancelSwitchRequest} className="w-7 h-7 rounded-full bg-tg-hover hover:bg-tg-active flex items-center justify-center transition-colors flex-shrink-0">
              <X size={12} className="text-tg-text" />
            </button>
          </div>
        )}
        {incomingSwitch && (
          <div className="bg-tg-panel border border-tg-hover rounded-2xl shadow-2xl px-3 py-2 flex items-center gap-2.5 min-w-[300px] max-w-[92vw] w-full">
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-full overflow-hidden">
                {otherUserAvatar ? (
                  <img src={otherUserAvatar} alt={otherUserName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-tg-accent flex items-center justify-center text-xs text-white font-semibold">
                    {otherUserName?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-tg-accent border border-tg-panel flex items-center justify-center">
                {incomingSwitch.to_video ? <VideoIcon size={9} className="text-white" /> : <Phone size={9} className="text-white" />}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-tg-text text-xs font-medium truncate">تغییر به تماس {incomingSwitch.to_video ? 'تصویری' : 'صوتی'}</p>
              <p className="text-tg-subtext text-[10px] truncate">{otherUserName} درخواست داد</p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button onClick={() => respondToSwitch(false)} className="w-8 h-8 rounded-full bg-tg-red hover:bg-red-600 flex items-center justify-center transition-colors">
                <X size={14} className="text-white" />
              </button>
              <button onClick={() => respondToSwitch(true)} className="w-8 h-8 rounded-full bg-tg-green hover:bg-green-600 flex items-center justify-center transition-colors">
                <Check size={14} className="text-white" />
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Pre-join preview screen (video calls only) — lets user pick background
  // before connecting. Caller sees this before ringing; callee sees it after
  // accepting but before joining.
  if (showPreview && !callStarted && isVideo) {
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col">
        <button onClick={isCaller ? cancelPreview : rejectCall} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white z-30 transition-colors">
          <X size={18} />
        </button>

        {/* Live camera preview */}
        <div className="flex-1 relative overflow-hidden">
          <video
            ref={previewVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60 pointer-events-none" />
        </div>

        {/* Background picker */}
        <div className="relative z-20 px-4 pb-6 pt-4 bg-tg-panel rounded-t-3xl shadow-2xl">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-tg-accent" />
            <p className="text-tg-text text-base font-medium">آماده‌سازی تماس تصویری</p>
          </div>

          <p className="text-tg-subtext text-xs mb-3">پس‌زمینه مورد نظر را انتخاب کنید</p>

          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {backgroundPresets.map((preset, i) => (
              <button
                key={i}
                onClick={() => setBgConfig({
                  mode: preset.mode,
                  color: preset.color,
                  imageUrl: preset.imageUrl,
                  blurAmount: 12,
                })}
                className={`relative rounded-xl overflow-hidden flex-shrink-0 w-20 h-20 border-2 transition-all ${
                  bgConfig.mode === preset.mode &&
                  ((preset.mode === 'color' && bgConfig.color === preset.color) ||
                   (preset.mode === 'image' && bgConfig.imageUrl === preset.imageUrl) ||
                   (preset.mode === 'blur') ||
                   (preset.mode === 'none'))
                    ? 'border-tg-accent scale-105' : 'border-transparent opacity-70 hover:opacity-100'
                }`}
                style={preset.mode === 'color' ? { backgroundColor: preset.color } : undefined}
              >
                {preset.mode === 'image' && preset.imageUrl && (
                  <img src={preset.imageUrl} alt={preset.label} className="w-full h-full object-cover" />
                )}
                {preset.mode === 'blur' && (
                  <div className="w-full h-full bg-gradient-to-br from-tg-accent/30 to-tg-bg flex items-center justify-center">
                    <Eye size={18} className="text-tg-text" />
                  </div>
                )}
                {preset.mode === 'none' && (
                  <div className="w-full h-full bg-tg-hover flex items-center justify-center">
                    <VideoIcon size={18} className="text-tg-text" />
                  </div>
                )}
                <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-white bg-black/60 py-0.5">{preset.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={isCaller ? startCall : joinCall}
            className="w-full mt-4 bg-tg-green hover:bg-green-600 text-white font-medium rounded-2xl py-3.5 flex items-center justify-center gap-2 transition-colors"
          >
            <Phone size={20} />
            <span>{isCaller ? 'شروع تماس' : 'ورود به تماس'}</span>
          </button>
        </div>
      </div>
    )
  }

  if (!isCaller && !callStarted) {
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col items-center justify-center">
        <button onClick={onMinimize} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center text-white transition-colors">
          <Minimize2 size={18} />
        </button>
        <audio ref={remoteAudioRef} autoPlay playsInline className="absolute w-0 h-0 opacity-0 pointer-events-none" />
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-tg-green animate-pulse-ring" />
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-tg-green">
            {otherUserAvatar ? (
              <img src={otherUserAvatar} alt={otherUserName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-tg-accent flex items-center justify-center text-4xl text-white">
                {otherUserName?.charAt(0)}
              </div>
            )}
          </div>
        </div>
        <p className="text-tg-text text-xl font-semibold mb-1">{otherUserName}</p>
        <p className="text-tg-subtext text-sm mb-8">{isVideo ? 'تماس تصویری' : 'تماس صوتی'} ورودی...</p>
        <div className="flex items-center gap-12">
          <button onClick={rejectCall} className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-tg-red flex items-center justify-center hover:bg-red-600 transition-colors">
              <X size={28} className="text-white" />
            </div>
            <span className="text-tg-subtext text-sm">رد</span>
          </button>
          <button onClick={acceptCall} className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-tg-green flex items-center justify-center hover:bg-green-600 transition-colors animate-ring">
              <Phone size={28} className="text-white" />
            </div>
            <span className="text-tg-subtext text-sm">قبول</span>
          </button>
        </div>
      </div>
    )
  }

  if (isCaller && status === 'ringing' && !connected) {
    return (
      <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col items-center justify-center">
        <button onClick={onMinimize} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center text-white transition-colors">
          <Minimize2 size={18} />
        </button>
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-tg-accent animate-pulse-ring" />
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-tg-accent">
            {otherUserAvatar ? (
              <img src={otherUserAvatar} alt={otherUserName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-tg-accent flex items-center justify-center text-4xl text-white">
                {otherUserName?.charAt(0)}
              </div>
            )}
          </div>
        </div>
        <p className="text-tg-text text-xl font-semibold mb-1">{otherUserName}</p>
        <p className="text-tg-subtext text-sm mb-8">در حال زنگ خوردن...</p>
        <audio ref={remoteAudioRef} autoPlay playsInline className="absolute w-0 h-0 opacity-0 pointer-events-none" />
        <button onClick={endCall} className="w-14 h-14 rounded-full bg-tg-red flex items-center justify-center hover:bg-red-600 transition-colors">
          <PhoneOff size={24} className="text-white" />
        </button>
      </div>
    )
  }

  // Active call screen
  return (
    <div className="fixed inset-0 bg-tg-bg z-[90] flex flex-col">
      <button onClick={onMinimize} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white z-30 transition-colors">
        <Minimize2 size={18} />
      </button>

      {/* Audio output selector (top-right) */}
      {audioOutputs.length > 1 && (
        <div className="absolute top-4 right-4 z-30">
          <div className="relative">
            <button
              onClick={() => document.getElementById('audio-output-select')?.click()}
              className="flex items-center gap-2 bg-black/30 hover:bg-black/50 text-white rounded-full px-3 py-2 text-xs transition-colors"
            >
              <Volume2 size={14} />
              <span>خروجی صدا</span>
            </button>
            <select
              id="audio-output-select"
              value={selectedOutput}
              onChange={(e) => changeAudioOutput(e.target.value)}
              className="absolute top-10 right-0 bg-tg-panel text-tg-text rounded-lg border border-tg-hover px-2 py-1 text-xs opacity-0 pointer-events-none"
            >
              {audioOutputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'دستگاه صوتی'}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isVideo ? (
        <>
          <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          <video ref={localVideoRef} autoPlay playsInline muted className="absolute top-4 right-4 w-32 h-44 rounded-2xl object-cover border-2 border-tg-accent z-10" />
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center">
          <audio ref={remoteAudioRef} autoPlay playsInline className="absolute w-0 h-0 opacity-0 pointer-events-none" />
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-tg-accent mb-4">
            {otherUserAvatar ? (
              <img src={otherUserAvatar} alt={otherUserName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-tg-accent flex items-center justify-center text-4xl text-white">
                {otherUserName?.charAt(0)}
              </div>
            )}
          </div>
          <p className="text-tg-text text-xl font-semibold">{otherUserName}</p>
          <p className="text-tg-subtext text-sm mt-1">{connected ? 'در حال مکالمه' : 'در حال اتصال...'}</p>
        </div>
      )}

      {/* Background effects panel (video calls only) */}
      {isVideo && bgPanelOpen && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 bg-tg-panel rounded-2xl shadow-2xl border border-tg-hover p-4 w-[90vw] max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-tg-accent" />
            <p className="text-tg-text text-sm font-medium">تغییر پس‌زمینه</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {backgroundPresets.map((preset, i) => (
              <button
                key={i}
                onClick={() => setBgConfig({
                  mode: preset.mode,
                  color: preset.color,
                  imageUrl: preset.imageUrl,
                  blurAmount: 12,
                })}
                className={`relative rounded-xl overflow-hidden h-16 border-2 transition-colors ${
                  bgConfig.mode === preset.mode &&
                  ((preset.mode === 'color' && bgConfig.color === preset.color) ||
                   (preset.mode === 'image' && bgConfig.imageUrl === preset.imageUrl) ||
                   (preset.mode === 'blur') ||
                   (preset.mode === 'none'))
                    ? 'border-tg-accent' : 'border-transparent'
                }`}
                style={preset.mode === 'color' ? { backgroundColor: preset.color } : undefined}
              >
                {preset.mode === 'image' && preset.imageUrl && (
                  <img src={preset.imageUrl} alt={preset.label} className="w-full h-full object-cover" />
                )}
                {preset.mode === 'blur' && (
                  <div className="w-full h-full bg-gradient-to-br from-tg-accent/30 to-tg-bg flex items-center justify-center">
                    <Eye size={16} className="text-tg-text" />
                  </div>
                )}
                {preset.mode === 'none' && (
                  <div className="w-full h-full bg-tg-hover flex items-center justify-center">
                    <VideoIcon size={16} className="text-tg-text" />
                  </div>
                )}
                <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-white bg-black/50 py-0.5">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pb-8 pt-4 flex items-center justify-center gap-3 bg-gradient-to-t from-tg-bg to-transparent relative z-20">
        <button onClick={toggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${muted ? 'bg-tg-red' : 'bg-tg-hover'}`}>
          {muted ? <MicOff size={20} className="text-white" /> : <Mic size={20} className="text-white" />}
        </button>

        {/* Audio/Video switch button */}
        {connected && (
          <button
            onClick={() => requestSwitchType(!isVideo)}
            disabled={outgoingSwitch || !!incomingSwitch}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${outgoingSwitch || incomingSwitch ? 'bg-tg-hover opacity-50' : 'bg-tg-hover hover:bg-tg-active'}`}
            title={isVideo ? 'تبدیل به تماس صوتی' : 'تبدیل به تماس تصویری'}
          >
            {isVideo ? <Phone size={20} className="text-white" /> : <VideoIcon size={20} className="text-white" />}
          </button>
        )}

        {isVideo && (
          <>
            <button onClick={toggleCamera} className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${cameraOff ? 'bg-tg-red' : 'bg-tg-hover'}`}>
              {cameraOff ? <VideoOff size={20} className="text-white" /> : <VideoIcon size={20} className="text-white" />}
            </button>
            <button
              onClick={() => setBgPanelOpen(!bgPanelOpen)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${bgPanelOpen ? 'bg-tg-accent' : 'bg-tg-hover'}`}
              title="افکت پس‌زمینه"
            >
              <Sparkles size={20} className="text-white" />
            </button>
          </>
        )}

        <button onClick={endCall} className="w-14 h-14 rounded-full bg-tg-red flex items-center justify-center hover:bg-red-600 transition-colors">
          <PhoneOff size={24} className="text-white" />
        </button>
      </div>

      {/* Outgoing switch request — waiting for the other side to accept */}
      {outgoingSwitch && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 bg-tg-panel border border-tg-hover rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
          <Loader2 size={18} className="text-tg-accent animate-spin" />
          <span className="text-tg-text text-sm">در انتظار پاسخ برای تغییر نوع تماس...</span>
          <button onClick={cancelSwitchRequest} className="w-7 h-7 rounded-full bg-tg-hover hover:bg-tg-active flex items-center justify-center transition-colors">
            <X size={14} className="text-tg-text" />
          </button>
        </div>
      )}

      {/* Incoming switch request — accept or reject */}
      {incomingSwitch && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center px-6">
          <div className="bg-tg-panel rounded-3xl shadow-2xl p-6 w-full max-w-xs flex flex-col items-center text-center">
            <div className="relative mb-3">
              <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-tg-accent">
                {otherUserAvatar ? (
                  <img src={otherUserAvatar} alt={otherUserName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-tg-accent flex items-center justify-center text-3xl text-white">
                    {otherUserName?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-tg-accent border-2 border-tg-panel flex items-center justify-center">
                {incomingSwitch.to_video ? <VideoIcon size={16} className="text-white" /> : <Phone size={16} className="text-white" />}
              </div>
            </div>
            <p className="text-tg-text text-base font-medium mb-1">{otherUserName}</p>
            <p className="text-tg-subtext text-sm mb-5">
              می‌خواد به تماس {incomingSwitch.to_video ? 'تصویری' : 'صوتی'} تغییر بده
            </p>
            <div className="flex items-center gap-4 w-full">
              <button onClick={() => respondToSwitch(false)} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-full bg-tg-red hover:bg-red-600 flex items-center justify-center transition-colors">
                  <X size={24} className="text-white" />
                </div>
                <span className="text-tg-subtext text-xs">رد</span>
              </button>
              <button onClick={() => respondToSwitch(true)} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-full bg-tg-green hover:bg-green-600 flex items-center justify-center transition-colors">
                  <Check size={24} className="text-white" />
                </div>
                <span className="text-tg-subtext text-xs">قبول</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Switch request rejected toast */}
      {switchRejected && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-tg-red text-white text-sm px-4 py-2 rounded-lg z-30">
          درخواست تغییر نوع تماس رد شد
        </div>
      )}

      {error && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-tg-red text-white text-sm px-4 py-2 rounded-lg z-30">
          {error}
        </div>
      )}
    </div>
  )
}
