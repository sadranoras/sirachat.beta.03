export type BackgroundMode = 'none' | 'blur' | 'color' | 'image'

let scriptPromise: Promise<void> | null = null
function loadMediapipeScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const w = window as any
    if (w.SelfieSegmentation) { resolve(); return }
    const script = document.createElement('script')
    script.src = '/mediapipe/selfie_segmentation.js'
    script.async = true
    script.onload = () => {
      if (w.SelfieSegmentation) resolve()
      else reject(new Error('SelfieSegmentation failed to initialize'))
    }
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Failed to load MediaPipe script'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export interface BackgroundConfig {
  mode: BackgroundMode
  color?: string
  imageUrl?: string
  blurAmount?: number
}

/**
 * Wraps MediaPipe Selfie Segmentation to process a camera stream and produce
 * a composed stream with the background replaced, blurred, or kept as-is.
 * The output stream's video track comes from a canvas capture stream.
 */
export class BackgroundProcessor {
  private segmentation: any
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private video: HTMLVideoElement
  private animationFrame: number | null = null
  private config: BackgroundConfig = { mode: 'none' }
  private bgImage: HTMLImageElement | null = null
  private active = false
  private cameraEnabled = true
  private firstFrameProduced = false
  private initTimeout: ReturnType<typeof setTimeout> | null = null

  private constructor(segmentation: any) {
    this.segmentation = segmentation
    this.segmentation.setOptions({ modelSelection: 1 })
    this.segmentation.onResults((results: any) => this.onResults(results))

    this.canvas = document.createElement('canvas')
    this.canvas.width = 1280
    this.canvas.height = 720
    this.ctx = this.canvas.getContext('2d')!
    this.video = document.createElement('video')
    this.video.autoplay = true
    this.video.playsInline = true
    this.video.muted = true
  }

  static async create(): Promise<BackgroundProcessor> {
    await loadMediapipeScript()
    const SS = (window as any).SelfieSegmentation
    if (!SS) throw new Error('SelfieSegmentation not available on window')
    const segmentation = new SS({
      locateFile: (file: string) => `/mediapipe/${file}`,
    })
    return new BackgroundProcessor(segmentation)
  }

  setConfig(config: BackgroundConfig) {
    this.config = config
    if (config.mode === 'image' && config.imageUrl) {
      if (!this.bgImage || this.bgImage.src !== config.imageUrl) {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = config.imageUrl
        this.bgImage = img
      }
    } else if (config.mode !== 'image') {
      this.bgImage = null
    }
  }

  setCameraEnabled(enabled: boolean) {
    this.cameraEnabled = enabled
  }

  async setInputStream(stream: MediaStream) {
    this.video.srcObject = stream
    await this.video.play().catch(() => {})
    // Cap canvas at 720p to keep segmentation fast; downscale larger inputs.
    const track = stream.getVideoTracks()[0]
    if (track) {
      const settings = track.getSettings()
      if (settings.width && settings.height) {
        const maxW = 1280
        const maxH = 720
        if (settings.width > maxW || settings.height > maxH) {
          const scale = Math.min(maxW / settings.width, maxH / settings.height)
          this.canvas.width = Math.round(settings.width * scale)
          this.canvas.height = Math.round(settings.height * scale)
        } else {
          this.canvas.width = settings.width
          this.canvas.height = settings.height
        }
      }
    }
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.firstFrameProduced = false
    this.initTimeout = setTimeout(() => {
      if (!this.firstFrameProduced && this.onInitFailed) {
        this.onInitFailed(new Error('MediaPipe failed to produce first frame within 8 seconds'))
      }
    }, 8000)
    const loop = async () => {
      if (!this.active) return
      if (this.video.readyState >= 2) {
        try {
          await this.segmentation.send({ image: this.video })
        } catch {
          // skip frame on error
        }
      }
      this.animationFrame = requestAnimationFrame(loop)
    }
    loop()
  }

  onInitFailed: ((error: Error) => void) | null = null
  onFirstFrame: (() => void) | null = null

  private onResults(results: any) {
    this.firstFrameProduced = true
    if (this.initTimeout) { clearTimeout(this.initTimeout); this.initTimeout = null }
    if (this.onFirstFrame) { this.onFirstFrame(); this.onFirstFrame = null }
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    const mask = results.segmentationMask
    const vid = results.image

    ctx.clearRect(0, 0, w, h)

    if (!this.cameraEnabled) {
      // Camera off: draw a black frame so the peer sees "camera off"
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, w, h)
      return
    }

    ctx.save()

    // Mirror (selfie view)
    ctx.scale(-1, 1)

    if (this.config.mode === 'none') {
      // Passthrough: draw the raw frame as-is
      ctx.drawImage(vid, -w, 0, w, h)
    } else {
      // 1. Draw the person (raw video frame)
      ctx.drawImage(vid, -w, 0, w, h)

      // 2. Keep only person pixels using the mask
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(mask, -w, 0, w, h)

      // 3. Draw background behind the person
      ctx.globalCompositeOperation = 'destination-over'
      if (this.config.mode === 'blur') {
        ctx.filter = `blur(${this.config.blurAmount || 12}px)`
        ctx.drawImage(vid, -w, 0, w, h)
        ctx.filter = 'none'
      } else if (this.config.mode === 'color') {
        ctx.fillStyle = this.config.color || '#1e293b'
        ctx.fillRect(-w, 0, w, h)
      } else if (this.config.mode === 'image' && this.bgImage && this.bgImage.complete) {
        ctx.drawImage(this.bgImage, -w, 0, w, h)
      }
    }

    ctx.restore()
  }

  stop() {
    this.active = false
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
  }

  getOutputStream(): MediaStream {
    return this.canvas.captureStream(30)
  }

  getCanvasWidth() { return this.canvas.width }
  getCanvasHeight() { return this.canvas.height }

  dispose() {
    this.stop()
    if (this.initTimeout) { clearTimeout(this.initTimeout); this.initTimeout = null }
    this.onInitFailed = null
    this.onFirstFrame = null
    this.video.srcObject = null
    try { this.segmentation.close() } catch {}
  }
}
