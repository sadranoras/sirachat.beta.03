import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause } from 'lucide-react'

interface VoicePlayerProps {
  src: string
  duration: number | null
  isMine: boolean
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function VoicePlayer({ src, duration, isMine }: VoicePlayerProps) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [actualDuration, setActualDuration] = useState(duration || 0)
  const [seeking, setSeeking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      if (audio.ended) audio.currentTime = 0
      audio.play().catch(() => {})
    }
  }, [playing])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => { if (!seeking) setCurrentTime(audio.currentTime) }
    const onMeta = () => { if (audio.duration && isFinite(audio.duration)) setActualDuration(audio.duration) }
    const onEnd = () => { setPlaying(false); setCurrentTime(0) }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('ended', onEnd)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('ended', onEnd)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [seeking])

  const seekFromEvent = (clientX: number) => {
    const audio = audioRef.current
    const bar = barRef.current
    if (!audio || !bar || !actualDuration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    audio.currentTime = ratio * actualDuration
    setCurrentTime(audio.currentTime)
  }

  const progress = actualDuration > 0 ? currentTime / actualDuration : 0
  const bars = 28
  const filledBars = Math.round(progress * bars)

  return (
    <div className="flex items-center gap-2.5 min-w-[220px] py-0.5 select-none">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-90 ${isMine ? 'bg-white/20' : 'bg-tg-accent'}`}
      >
        {playing ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1" dir="ltr">
        <div
          ref={barRef}
          className="relative flex items-center gap-0.5 h-6 cursor-pointer"
          onPointerDown={(e) => { setSeeking(true); seekFromEvent(e.clientX); (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }}
          onPointerMove={(e) => { if (seeking) seekFromEvent(e.clientX) }}
          onPointerUp={(e) => { setSeeking(false); seekFromEvent(e.clientX); (e.target as HTMLElement).releasePointerCapture?.(e.pointerId) }}
        >
          {Array.from({ length: bars }).map((_, i) => {
            const isFilled = i < filledBars
            const heights = [10, 14, 8, 16, 12, 20, 9, 18, 11, 15, 7, 17, 13, 19, 10, 14, 8, 16, 12, 20, 9, 18, 11, 15, 7, 17, 13, 19]
            const h = heights[i % heights.length]
            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-colors ${isFilled ? (isMine ? 'bg-white/80' : 'bg-tg-accent') : (isMine ? 'bg-white/30' : 'bg-tg-subtext/40')}`}
                style={{ height: `${h}px` }}
              />
            )
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[11px] tabular-nums ${isMine ? 'text-white/70' : 'text-tg-subtext'}`}>
            {formatTime(currentTime)}
          </span>
          <span className={`text-[11px] tabular-nums ${isMine ? 'text-white/50' : 'text-tg-subtext/60'}`}>
            {formatTime(actualDuration)}
          </span>
        </div>
      </div>
    </div>
  )
}
