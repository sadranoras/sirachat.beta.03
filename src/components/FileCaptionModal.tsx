import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, FileIcon, ImageIcon } from 'lucide-react'

interface FileCaptionModalProps {
  type: 'image' | 'file'
  file: File
  onSend: (caption: string) => void
  onClose: () => void
}

export default function FileCaptionModal({ type, file, onSend, onClose }: FileCaptionModalProps) {
  const [caption, setCaption] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (type !== 'image') return
    const reader = new FileReader()
    reader.onload = () => setPreviewUrl(reader.result as string)
    reader.readAsDataURL(file)
    return () => { setPreviewUrl(null) }
  }, [type, file])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-[300] flex items-center justify-center p-4 animate-scaleIn"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="bg-tg-panel rounded-2xl w-full max-w-md shadow-2xl border border-tg-hover overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-tg-border">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-tg-hover flex items-center justify-center text-tg-subtext hover:text-tg-text transition-colors"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-2.5">
            <h2 className="text-tg-text font-medium text-base">
              {type === 'image' ? 'ارسال تصویر' : 'ارسال فایل'}
            </h2>
            {type === 'image' ? (
              <ImageIcon size={20} className="text-tg-accent" />
            ) : (
              <FileIcon size={20} className="text-tg-accent" />
            )}
          </div>
        </div>

        <div className="p-5">
          {type === 'image' && previewUrl ? (
            <div className="bg-tg-bg rounded-xl overflow-hidden mb-4 flex items-center justify-center max-h-72">
              <img
                src={previewUrl}
                alt="preview"
                className="w-full h-full object-contain max-h-72"
              />
            </div>
          ) : (
            <div className="bg-tg-bg rounded-xl p-6 mb-4 flex items-center gap-4">
              <div className="min-w-0 flex-1 text-right">
                <p className="text-tg-text text-sm font-medium truncate">{file.name}</p>
                <p className="text-tg-subtext text-xs mt-1">{formatSize(file.size)}</p>
              </div>
              <div className="w-14 h-14 rounded-xl bg-tg-hover flex items-center justify-center flex-shrink-0">
                <FileIcon size={28} className="text-tg-accent" />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => onSend(caption)}
              className="w-12 h-12 rounded-full bg-tg-accent hover:bg-tg-accent2 flex items-center justify-center flex-shrink-0 transition-colors shadow-lg"
            >
              <Send size={20} className="text-white" />
            </button>
            <input
              type="text"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder={type === 'image' ? 'توضیح تصویر...' : 'توضیح فایل...'}
              onKeyDown={e => { if (e.key === 'Enter') onSend(caption) }}
              className="flex-1 bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none text-sm focus:ring-2 ring-tg-accent/40 transition-all"
              dir="rtl"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
