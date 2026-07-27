interface AvatarProps { url: string | null | undefined; name: string; size: number }

export default function Avatar({ url, name, size }: AvatarProps) {
  const initials = (name || '?').charAt(0).toUpperCase()
  if (url) {
    return <img src={url} alt={name} style={{ width: size, height: size }} className="rounded-full object-cover flex-shrink-0" />
  }
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.4 }} className="rounded-full bg-tg-accent flex items-center justify-center text-white font-medium flex-shrink-0">
      {initials}
    </div>
  )
}
