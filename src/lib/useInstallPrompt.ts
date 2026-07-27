import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: minimal-ui)').matches
  )
}

let deferredPromptRef: BeforeInstallPromptEvent | null = null
const listeners = new Set<(p: BeforeInstallPromptEvent | null) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    deferredPromptRef = e as BeforeInstallPromptEvent
    listeners.forEach((fn) => fn(deferredPromptRef))
  })

  window.addEventListener('appinstalled', () => {
    deferredPromptRef = null
    listeners.forEach((fn) => fn(null))
  })
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(deferredPromptRef)
  const [standalone] = useState(isStandalone)

  useEffect(() => {
    const fn = (p: BeforeInstallPromptEvent | null) => setPrompt(p)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const triggerInstall = async (): Promise<boolean> => {
    if (!deferredPromptRef) return false
    await deferredPromptRef.prompt()
    const { outcome } = await deferredPromptRef.userChoice
    deferredPromptRef = null
    setPrompt(null)
    listeners.forEach((fn) => fn(null))
    return outcome === 'accepted'
  }

  return { canInstall: !!prompt && !standalone, standalone, triggerInstall }
}

export function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  if (isIOS) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}
