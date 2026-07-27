interface ReactionPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
  top: number
  left: number
}

const EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉', '🙏', '👏', '😢', '😡', '💯', '😎', '🤔', '😍', '🥰', '😘', '🤗', '😴', '🥳', '😱', '🤝', '💪', '🌟', '✨', '🎁', '🌹', '🍕', '☕', '🎶', '🙌', '🤞', '✅', '❌', '💔', '💩', '🤯', '🥺', '😇', '🤩', '😬', '🤨', '😅', '🫡', '🫶', '💀', '🫠', '🥹']

export default function ReactionPicker({ onSelect, onClose, top, left }: ReactionPickerProps) {
  const clampedTop = Math.min(top, window.innerHeight - 188)
  const clampedLeft = Math.min(left, window.innerWidth - 268)
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-tg-panel rounded-2xl shadow-2xl border border-tg-hover p-2 animate-scaleIn w-[260px] h-[180px] overflow-y-auto overflow-x-hidden"
        style={{ top: Math.max(8, clampedTop), left: Math.max(8, clampedLeft), WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map(emoji => (
            <button key={emoji} onClick={() => onSelect(emoji)} className="text-2xl hover:bg-tg-hover rounded-lg p-1.5 transition-all hover:scale-125 transform">
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
