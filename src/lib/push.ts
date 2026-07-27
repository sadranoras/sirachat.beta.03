import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmHN5IKFHA1bbTIaK6MM26aujKvf-ZJv1kT_IfkXi2JKCJoD0P9Rc8EpvkLIWdwIqiHLTFj4jXmEsEScN3sFM7A'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function subscribeToPush(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      })
    }

    const subAny = sub as unknown as { endpoint: string; keys?: { p256dh?: string; auth?: string } }
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: subAny.endpoint,
      p256dh: subAny.keys?.p256dh || '',
      auth: subAny.keys?.auth || '',
    }, { onConflict: 'user_id,endpoint' })

    if (error) {
      console.error('Failed to save push subscription:', error)
      return false
    }
    return true
  } catch (e) {
    console.error('Push subscription failed:', e)
    return false
  }
}

export async function sendPushNotification(chatId: string, messageId: string, senderId: string, content: string, messageType: string) {
  try {
    const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = import.meta.env
    const response = await fetch(`${VITE_SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        sender_id: senderId,
        content,
        message_type: messageType,
      }),
    })
    if (!response.ok) console.error('Push notification failed:', response.status)
  } catch (e) {
    console.error('Push notification error:', e)
  }
}
