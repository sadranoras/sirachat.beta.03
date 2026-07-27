import { useState, useEffect } from 'react'

export default function SplashScreen() {
  const [show, setShow] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1800)
    const hideTimer = setTimeout(() => setShow(false), 2200)
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer) }
  }, [])

  if (!show) return null

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col items-center justify-center bg-tg-bg transition-opacity duration-400 ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex flex-col items-center gap-6">
        <img
          src="/03.png"
          alt="سیرا چت"
          className="w-40 h-40 rounded-3xl object-cover shadow-2xl animate-splashZoom"
        />
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-tg-text text-2xl font-bold">سیرا چت</h1>
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-tg-accent animate-splashDot" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-tg-accent animate-splashDot" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-tg-accent animate-splashDot" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
