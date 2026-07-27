import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { MessageCircle, Phone, Mail } from 'lucide-react'

export default function AuthScreen() {
  const { signInWithPhone, signInWithEmail, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [loginMethod, setLoginMethod] = useState<'phone' | 'email'>('phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    if (mode === 'signin') {
      if (loginMethod === 'phone') {
        if (!phone.trim()) { setError('شماره تلفن الزامی است'); setLoading(false); return }
        const { error } = await signInWithPhone(phone.trim(), password)
        if (error) setError(error)
      } else {
        if (!loginEmail.trim()) { setError('ایمیل الزامی است'); setLoading(false); return }
        const { error } = await signInWithEmail(loginEmail.trim(), password)
        if (error) setError(error)
      }
    } else {
      if (!displayName.trim()) { setError('نام نمایشی الزامی است'); setLoading(false); return }
      if (!phone.trim()) { setError('شماره تلفن الزامی است'); setLoading(false); return }
      const { error } = await signUp(email, password, displayName.trim(), phone.trim())
      if (error) setError(error)
      else setInfo('حساب شما ساخته شد. وارد شوید.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-tg-bg p-4">
      <div className="bg-tg-panel rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-full bg-tg-accent flex items-center justify-center mb-3">
            <MessageCircle size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-tg-text">سیرا چت</h1>
          <p className="text-tg-subtext text-sm mt-1">{mode === 'signin' ? 'وارد شوید' : 'حساب جدید بسازید'}</p>
        </div>

        {mode === 'signin' && (
          <div className="flex bg-tg-hover rounded-xl p-1 mb-4">
            <button
              type="button"
              onClick={() => { setLoginMethod('phone'); setError(null) }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${loginMethod === 'phone' ? 'bg-tg-accent text-white' : 'text-tg-subtext hover:text-tg-text'}`}
            >
              <Phone size={16} />
              شماره تلفن
            </button>
            <button
              type="button"
              onClick={() => { setLoginMethod('email'); setError(null) }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${loginMethod === 'email' ? 'bg-tg-accent text-white' : 'text-tg-subtext hover:text-tg-text'}`}
            >
              <Mail size={16} />
              ایمیل
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signin' ? (
            loginMethod === 'phone' ? (
              <input type="tel" placeholder="شماره تلفن" value={phone} onChange={e => setPhone(e.target.value)} required className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="ltr" />
            ) : (
              <input type="email" placeholder="ایمیل" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="ltr" />
            )
          ) : (
            <>
              <input type="text" placeholder="نام نمایشی" value={displayName} onChange={e => setDisplayName(e.target.value)} required className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="rtl" />
              <input type="tel" placeholder="شماره تلفن" value={phone} onChange={e => setPhone(e.target.value)} required className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="ltr" />
              <input type="email" placeholder="ایمیل" value={email} onChange={e => setEmail(e.target.value)} required className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="ltr" />
            </>
          )}
          <input type="password" placeholder="رمز عبور" value={password} onChange={e => setPassword(e.target.value)} required className="w-full bg-tg-hover rounded-xl px-4 py-3 text-tg-text placeholder-tg-subtext outline-none focus:ring-2 ring-tg-accent" dir="ltr" />
          {error && <p className="text-tg-red text-sm text-center">{error}</p>}
          {info && <p className="text-tg-accent text-sm text-center">{info}</p>}
          <button type="submit" disabled={loading} className="w-full bg-tg-accent hover:bg-tg-accent2 text-white font-semibold rounded-xl py-3 transition-colors disabled:opacity-50">
            {loading ? '...' : mode === 'signin' ? 'ورود' : 'ثبت‌نام'}
          </button>
        </form>
        <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null) }} className="w-full text-center text-tg-accent text-sm mt-4 hover:underline">
          {mode === 'signin' ? 'حساب ندارید؟ ثبت‌نام کنید' : 'حساب دارید؟ وارد شوید'}
        </button>
      </div>
    </div>
  )
}
