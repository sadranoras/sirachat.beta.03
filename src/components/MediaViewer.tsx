import { useEffect, useState, useRef } from 'react'
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react'

export interface MediaItem {
  url: string
  type: 'image' | 'video'
  name: string
}

interface MediaViewerProps {
  items: MediaItem[]
  startIndex: number
  onClose: () => void
}

export default function MediaViewer({ items, startIndex, onClose }: MediaViewerProps) {
  const [index, setIndex] = useState(startIndex)
  const [downloading, setDownloading] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => (i + 1) % items.length)
      if (e.key === 'ArrowRight') setIndex((i) => (i - 1 + items.length) % items.length)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [items.length, onClose])

  const current = items[index]
  if (!current) return null

  const download = async () => {
    setDownloading(true)
    try {
      const res = await fetch(current.url)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = current.name || 'media'
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
    setDownloading(false)
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
        <X size={24} />
      </button>
      <button onClick={download} disabled={downloading} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10 disabled:opacity-50">
        <Download size={22} />
      </button>

      {items.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % items.length) }} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
            <ChevronRight size={26} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + items.length) % items.length) }} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
            <ChevronLeft size={26} />
          </button>
        </>
      )}

      <div className="w-full h-full flex items-center justify-center p-4" onClick={onClose}>
        {current.type === 'image' ? (
          <img src={current.url} alt={current.name} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        ) : (
          <video
            ref={videoRef}
            src={current.url}
            controls
            autoPlay
            className="max-w-full max-h-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
          {index + 1} / {items.length}
        </div>
      )}
    </div>
  )
}
