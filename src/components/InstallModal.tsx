import { useState } from 'react'
import { Download, X, Share, Plus, Smartphone, Monitor, CheckCircle2 } from 'lucide-react'
import { useInstallPrompt, detectPlatform } from '../lib/useInstallPrompt'

export default function InstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { canInstall, standalone, triggerInstall } = useInstallPrompt()
  const [platform] = useState(detectPlatform)
  const [status, setStatus] = useState<'idle' | 'installing' | 'done'>('idle')

  if (!open) return null

  const handleInstall = async () => {
    setStatus('installing')
    const accepted = await triggerInstall()
    if (accepted) {
      setStatus('done')
    } else {
      setStatus('idle')
    }
  }

  const platformName = platform === 'ios' ? 'آیفون و آیپد' : platform === 'android' ? 'اندروید' : 'دسکتاپ'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 animate-fadeIn" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-tg-panel border border-tg-hover shadow-2xl overflow-hidden animate-scaleIn"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-tg-border">
          <div className="flex items-center gap-2">
            <Download size={20} className="text-tg-accent" />
            <h2 className="text-tg-text font-bold text-base">نصب سیرا چت</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-tg-subtext hover:bg-tg-hover transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {standalone ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-tg-green/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={32} className="text-tg-green" />
              </div>
              <p className="text-tg-text font-medium">سیرا چت از قبل نصب شده!</p>
              <p className="text-tg-subtext text-sm mt-1">این برنامه در حال حاضر به‌صورت نصب‌شده اجرا می‌شود.</p>
            </div>
          ) : status === 'done' ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-tg-green/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={32} className="text-tg-green" />
              </div>
              <p className="text-tg-text font-medium">سیرا چت نصب شد!</p>
              <p className="text-tg-subtext text-sm mt-1">می‌توانید آن را از صفحه اصلی باز کنید.</p>
            </div>
          ) : canInstall ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-tg-accent/20 flex items-center justify-center mx-auto mb-4">
                <Smartphone size={32} className="text-tg-accent" />
              </div>
              <p className="text-tg-text font-medium leading-relaxed">برای نصب سیرا چت روی دستگاه خود، دکمه زیر را بزنید.</p>
              <p className="text-tg-subtext text-sm mt-1 leading-relaxed">پس از نصب، می‌توانید بدون مرورگر و با آیکون اختصاصی وارد اپ شوید.</p>
              <button
                onClick={handleInstall}
                disabled={status === 'installing'}
                className="mt-5 w-full py-3 rounded-xl bg-tg-accent text-white font-medium hover:bg-tg-accent/90 transition-colors active:scale-95 disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2"
              >
                {status === 'installing' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    در حال نصب...
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    نصب اپ
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              <div className="w-16 h-16 rounded-2xl bg-tg-accent/20 flex items-center justify-center mx-auto mb-4">
                {platform === 'desktop' ? <Monitor size={32} className="text-tg-accent" /> : <Smartphone size={32} className="text-tg-accent" />}
              </div>
              <p className="text-tg-text font-medium text-center mb-1">راهنمای نصب روی {platformName}</p>
              <p className="text-tg-subtext text-sm text-center leading-relaxed mb-5">برای نصب، مراحل زیر را دنبال کنید:</p>

              {platform === 'ios' ? (
                <ol className="text-tg-text text-sm leading-relaxed space-y-3 list-decimal pr-5">
                  <li>دکمه <span className="inline-flex items-center gap-1 font-medium text-tg-accent">اشتراک‌گذاری <Share size={14} /></span> را در نوار پایین مرورگر سافاری بزنید.</li>
                  <li>در منوی باز شده، گزینه <span className="font-medium text-tg-accent">«افزودن به صفحه اصلی»</span> را پیدا و انتخاب کنید.</li>
                  <li>روی <span className="font-medium text-tg-accent">«افزودن»</span> بزنید تا سیرا چت با آیکون خودش روی دستگاه نصب شود.</li>
                </ol>
              ) : platform === 'android' ? (
                <ol className="text-tg-text text-sm leading-relaxed space-y-3 list-decimal pr-5">
                  <li>منوی مرورگر کروم (آیکون <span className="font-medium text-tg-accent">سه نقطه</span> در بالا یا پایین) را باز کنید.</li>
                  <li>گزینه <span className="font-medium text-tg-accent">«افزودن به صفحه اصلی»</span> یا <span className="font-medium text-tg-accent">«Install app»</span> را انتخاب کنید.</li>
                  <li>روی <span className="font-medium text-tg-accent">«نصب»</span> بزنید تا سیرا چت روی دستگاه نصب شود.</li>
                </ol>
              ) : (
                <ol className="text-tg-text text-sm leading-relaxed space-y-3 list-decimal pr-5">
                  <li>در نوار آدرس مرورگر، آیکون <span className="font-medium text-tg-accent">نصب</span> را در سمت راست پیدا کنید.</li>
                  <li>روی آن کلیک کنید و سپس <span className="font-medium text-tg-accent">«نصب»</span> را انتخاب کنید.</li>
                  <li>سیرا چت در پنجره‌ی جداگانه و بدون نوار مرورگر باز می‌شود.</li>
                </ol>
              )}

              <div className="mt-5 p-3 rounded-xl bg-tg-hover/50 border border-tg-border">
                <p className="text-tg-subtext text-xs leading-relaxed">
                  پس از نصب، سیرا چت با آیکون اختصاصی خود روی صفحه‌ی اصلی دستگاه شما ظاهر می‌شود و بدون نیاز به باز کردن مرورگر، مستقیماً اجرا می‌شود.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
