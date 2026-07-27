import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { Profile } from './types'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  signInWithPhone: (phone: string, password: string) => Promise<{ error: string | null }>
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, displayName: string, phone: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (!error && data) setProfile(data as Profile)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        loadProfile(s.user.id).then(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Online heartbeat system
  useEffect(() => {
    if (!user) return

    // Online only when the tab is visible AND the window is focused.
    // A visible-but-unfocused window means the user is in another app,
    // so they should appear offline.
    const isActuallyPresent = () =>
      document.visibilityState === 'visible' && document.hasFocus()

    const setOnline = async () => {
      if (!isActuallyPresent()) return
      await supabase.from('profiles').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user.id)
    }
    const setOffline = async () => {
      await supabase.from('profiles').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', user.id)
    }

    setOnline()
    const heartbeat = setInterval(() => { isActuallyPresent() ? setOnline() : setOffline() }, 15000)

    const syncPresence = () => { isActuallyPresent() ? setOnline() : setOffline() }
    document.addEventListener('visibilitychange', syncPresence)
    window.addEventListener('focus', syncPresence)
    window.addEventListener('blur', syncPresence)

    const handleUnload = () => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`
      const body = JSON.stringify({ is_online: false, last_seen: new Date().toISOString() })
      try {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      } catch {
        // fallback: best-effort fetch
        fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Authorization': `Bearer ${session?.access_token || ''}` }, body, keepalive: true }).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', syncPresence)
      window.removeEventListener('focus', syncPresence)
      window.removeEventListener('blur', syncPresence)
      window.removeEventListener('beforeunload', handleUnload)
      setOffline()
    }
  }, [user, session?.access_token])

  const signInWithPhone = async (phone: string, password: string) => {
    const normalizedPhone = phone.trim()
    const { data: emailData, error: rpcError } = await supabase.rpc('get_email_by_phone', { p_phone: normalizedPhone })
    if (rpcError) return { error: 'خطا در بررسی شماره تلفن' }
    if (!emailData) return { error: 'شماره تلفن ثبت‌نشده است' }
    const email = emailData as string
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? (error.message || 'خطا در ورود. لطفاً دوباره تلاش کنید.') : null }
  }

  const signInWithEmail = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase()
    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
    if (error) return { error: error.message || 'خطا در ورود. لطفاً دوباره تلاش کنید.' }
    return { error: null }
  }

  const signUp = async (email: string, password: string, displayName: string, phone: string) => {
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPhone = phone.trim()

    // Check if phone is already registered by a confirmed user
    const { data: phoneTaken } = await supabase.rpc('check_phone_exists', { p_phone: normalizedPhone })
    if (phoneTaken) return { error: 'این شماره تلفن قبلاً ثبت شده است' }

    // Check if email is already registered by a confirmed user
    const { data: emailTaken } = await supabase.rpc('check_email_exists', { p_email: normalizedEmail })
    if (emailTaken) return { error: 'این ایمیل قبلاً ثبت شده است' }

    // Clean up any previous unconfirmed attempt with the same email OR phone
    await supabase.rpc('delete_unconfirmed_user', { p_email: normalizedEmail, p_phone: normalizedPhone })

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { data: { phone: normalizedPhone, full_name: displayName } },
    })
    if (error) return { error: error.message || 'خطا در ثبت‌نام. لطفاً دوباره تلاش کنید.' }
    if (data.user) {
      // The handle_new_user trigger already created the profile row with
      // the phone. Only update the display name here — do NOT re-insert,
      // which would conflict on the unique phone index.
      await supabase.from('profiles').update({ display_name: displayName }).eq('id', data.user.id)
    }
    return { error: null }
  }

  const signOut = async () => {
    if (user) {
      await supabase.from('profiles').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', user.id)
    }
    await supabase.auth.signOut()
    setProfile(null)
  }

  const updateProfile = async (updates: Partial<Profile>): Promise<{ error: string | null }> => {
    if (!user) return { error: 'not-signed-in' }
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (!error) {
      setProfile(prev => prev ? { ...prev, ...updates } : prev)
      return { error: null }
    }
    return { error: error.message }
  }

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signInWithPhone, signInWithEmail, signUp, signOut, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
