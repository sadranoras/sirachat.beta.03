import { supabase } from './supabase'
import { Message } from './types'
import { sendPushNotification } from './push'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export interface ActiveUpload {
  tempId: string
  chatId: string
  fileName: string
  fileSize: number
  type: 'image' | 'file'
  caption: string
  progress: number
  status: 'uploading' | 'inserting' | 'done' | 'error'
  message: Message | null
}

type Listener = (uploads: ActiveUpload[]) => void

const activeUploads = new Map<string, ActiveUpload>()
const listeners = new Set<Listener>()

function notify() {
  const all = Array.from(activeUploads.values())
  for (const l of listeners) l(all)
}

export function subscribeUploads(listener: Listener): () => void {
  listeners.add(listener)
  listener(Array.from(activeUploads.values()))
  return () => { listeners.delete(listener) }
}

export function getUploadsForChat(chatId: string): ActiveUpload[] {
  return Array.from(activeUploads.values()).filter(u => u.chatId === chatId)
}

async function uploadWithProgress(bucket: string, path: string, body: Blob, onProgress: (pct: number) => void): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || supabaseAnonKey
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(path) }
      else reject(new Error(`Upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream')
    xhr.send(body)
  })
}

export async function startFileUpload(
  chatId: string,
  userId: string,
  file: File,
  caption: string,
  type: 'image' | 'file',
  replyToId: string | null,
  sender: Message['sender'],
): Promise<void> {
  const ext = file.name.split('.').pop()
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const optimistic: Message = {
    id: tempId, chat_id: chatId, sender_id: userId, content: caption || '',
    created_at: new Date().toISOString(), message_type: type, file_url: null,
    file_name: file.name, file_size: file.size, duration: null,
    is_edited: false, is_pinned: false, reply_to: replyToId,
    deleted_at: null, read_at: null, sender: sender || undefined, reactions: [],
  }

  const entry: ActiveUpload = {
    tempId, chatId, fileName: file.name, fileSize: file.size, type, caption,
    progress: 0, status: 'uploading', message: optimistic,
  }
  activeUploads.set(tempId, entry)
  notify()

  let filePath: string
  try {
    filePath = await uploadWithProgress('media', fileName, file, (pct) => {
      const e = activeUploads.get(tempId)
      if (e) { e.progress = pct; notify() }
    })
  } catch {
    const e = activeUploads.get(tempId)
    if (e) { e.status = 'error'; notify() }
    setTimeout(() => { activeUploads.delete(tempId); notify() }, 3000)
    return
  }

  const e = activeUploads.get(tempId)
  if (e) { e.status = 'inserting'; notify() }

  const fileUrl = `${supabaseUrl}/storage/v1/object/public/media/${filePath}`
  const { data } = await supabase.from('messages').insert({
    chat_id: chatId, sender_id: userId, content: caption || '',
    message_type: type, file_url: fileUrl, file_name: file.name, file_size: file.size,
    reply_to: replyToId,
  }).select(`*, sender:profiles!messages_sender_id_profiles_fkey(*), reactions(*)`).single()

  if (data) {
    const realMsg = data as unknown as Message
    const e2 = activeUploads.get(tempId)
    if (e2) { e2.status = 'done'; e2.message = realMsg; notify() }
    window.dispatchEvent(new CustomEvent('chat-list-reload'))
    sendPushNotification(chatId, realMsg.id, userId, '', type)
  }

  setTimeout(() => { activeUploads.delete(tempId); notify() }, 500)
}
