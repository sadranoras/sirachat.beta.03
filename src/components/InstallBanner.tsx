import { useState } from 'react'
import { Download, X, Share, Plus } from 'lucide-react'
import { useInstallPrompt, detectPlatform } from '../lib/useInstallPrompt'

export default function InstallBanner() {
  const { canInstall, standalone, triggerInstall } = useInstallPrompt()
  const [platform] = useState(detectPlatform)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('sirachat-install-dismissed') === '1'
    } catch {
      return false
    }
  })
  const [showGuide, setShowGuide] = useState(false)
  const [installing, setInstalling] = useState(false)

  if (standalone || dismissed) return null

  const isMobile = platform === 'ios' || platform === 'android'
  const visible = canInstall || isMobile
  if (!visible) return null

  const showManualGuide = showGuide || (!canInstall && isMobile)

  const handleInstall = async () => {
    if (canInstall) {
      setInstalling(true)
      const accepted = await triggerInstall()
      setInstalling(false)
      if (accepted) {
        setDismissed(true)
        try { localStorage.setItem('sirachat-install-dismissed', '1') } catch {}
      }
    } else {
      setShowGuide(true)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    try { localStorage.setItem('sirachat-install-dismissed', '1') } catch {}
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[200] animate-slideDown">
      <div className="mx-auto max-w-2xl m-3 rounded-2xl bg-tg-panel border border-tg-hover shadow-2xl px-4 py-3">
        {!showManualGuide ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-tg-accent/20 flex items-center justify-center shrink-0">
              <Download size={20} className="text-tg-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-tg-text text-sm font-medium leading-tight">سیرا چت را نصب کنید</p>
              <p className="text-tg-subtext text-xs leading-tight mt-0.5">برای دسترسی سریع و تجربه بهتر، اپ را روی دستگاه خود نصب کنید</p>
            </div>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="shrink-0 px-4 py-2 rounded-xl bg-tg-accent text-white text-sm font-medium hover:bg-tg-accent/90 transition-colors active:scale-95 disabled:opacity-60 flex items-center gap-2"
            >
              {installing ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'نصب'
              )}
            </button>
            <button
              onClick={handleDismiss}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-tg-subtext hover:bg-tg-hover transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-tg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                {platform === 'ios' ? <Share size={20} className="text-tg-accent" /> : <Plus size={20} className="text-tg-accent" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-tg-text text-sm font-medium leading-tight">
                  نصب روی {platform === 'ios' ? 'آیفون و آیپد' : 'اندروید'}
                </p>
                {platform === 'ios' ? (
                  <ol className="text-tg-subtext text-xs leading-relaxed mt-1.5 space-y-1.5 list-decimal pr-4">
                    <li>دکمه <span className="inline-flex items-center gap-1 text-tg-text font-medium">اشتراک‌گذاری <Share size={12} /></span> را در نوار پایین مرورگر بزنید.</li>
                    <li>گزینه <span className="text-tg-text font-medium">«افزودن به صفحه اصلی»</span> را انتخاب کنید.</li>
                    <li>روی <span className="text-tg-text font-medium">«افزودن»</span> بزنید تا سیرا چت روی دستگاه نصب شود.</li>
                  </ol>
                ) : (
                  <ol className="text-tg-subtext text-xs leading-relaxed mt-1.5 space-y-1.5 list-decimal pr-4">
                    <li>منوی مرورگر (سه نقطه در بالا یا پایین) را باز کنید.</li>
                    <li>گزینه <span className="text-tg-text font-medium">«افزودن به صفحه اصلی»</span> یا <span className="text-tg-text font-medium">«Install app»</span> را انتخاب کنید.</li>
                    <li>روی <span className="text-tg-text font-medium">«نصب»</span> بزنید تا سیرا چت روی دستگاه نصب شود.</li>
                  </ol>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleDismiss}
                className="px-4 py-2 rounded-xl bg-tg-hover text-tg-text text-sm font-medium hover:bg-tg-hover/70 transition-colors active:scale-95"
              >
                باشه
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
