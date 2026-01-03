import type { ChatProvider } from '@xsai-ext/providers/utils'

import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { createResettableLocalStorage, createResettableRef } from '../../utils/resettable'
import { useProvidersStore } from '../providers'

/**
 * Vision-capable models that support image input
 * NOTICE: This list should be updated as new models are released
 */
const VISION_CAPABLE_MODEL_PATTERNS = [
  // OpenAI
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-4-vision',
  // Anthropic
  'claude-3',
  'claude-3.5',
  'claude-3-5',
  // Google
  'gemini-1.5',
  'gemini-2',
  'gemini-pro-vision',
  // Meta (via Groq, OpenRouter, etc.)
  'llama-4',
  'llama-3.2',
  'llama-3.3',
  // Local vision models
  'llava',
  'bakllava',
  'moondream',
  // Qwen
  'qwen-vl',
  'qwen2-vl',
  // Other
  'pixtral',
  'molmo',
]

export type CaptureSource = 'screen' | 'camera' | 'window'
export type AnalysisMode = 'on-demand' | 'continuous'

export interface VisionAnalysisResult {
  timestamp: number
  description: string
  imageDataUrl?: string // Only stored temporarily for preview
}

export interface CaptureOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
}

const DEFAULT_CAPTURE_OPTIONS: Required<CaptureOptions> = {
  maxWidth: 1280,
  maxHeight: 720,
  quality: 0.7,
}

export const useVisionStore = defineStore('vision-store', () => {
  const providersStore = useProvidersStore()
  const { allChatProvidersMetadata, configuredChatProvidersMetadata } = storeToRefs(providersStore)

  // Provider/Model Selection
  // NOTICE: Vision uses chat providers that support multimodal input
  const [activeVisionProvider, resetActiveVisionProvider] = createResettableLocalStorage('settings/vision/active-provider', '')
  const [activeVisionModel, resetActiveVisionModel] = createResettableLocalStorage('settings/vision/active-model', '')
  const [activeCustomModelName, resetActiveCustomModelName] = createResettableLocalStorage('settings/vision/active-custom-model', '')
  const [visionModelSearchQuery, resetVisionModelSearchQuery] = createResettableRef('')

  // Capture Settings
  const [captureSource, resetCaptureSource] = createResettableLocalStorage<CaptureSource>('settings/vision/capture-source', 'screen')
  const [analysisMode, resetAnalysisMode] = createResettableLocalStorage<AnalysisMode>('settings/vision/analysis-mode', 'on-demand')
  const [captureIntervalMs, resetCaptureIntervalMs] = createResettableLocalStorage('settings/vision/capture-interval', 5000)
  const [compressionQuality, resetCompressionQuality] = createResettableLocalStorage('settings/vision/compression-quality', 0.7)
  const [maxImageWidth, resetMaxImageWidth] = createResettableLocalStorage('settings/vision/max-width', 1280)
  const [maxImageHeight, resetMaxImageHeight] = createResettableLocalStorage('settings/vision/max-height', 720)
  // Selected desktop source for Electron screen/window capture
  const [selectedDesktopSourceId, resetSelectedDesktopSourceId] = createResettableLocalStorage('settings/vision/selected-source-id', '')

  // State
  const isCapturing = ref(false)
  const isAnalyzing = ref(false)
  const lastAnalysisResult = shallowRef<VisionAnalysisResult | null>(null)
  const analysisError = ref<string | null>(null)
  const currentStream = shallowRef<MediaStream | null>(null)
  const previewImageDataUrl = ref<string | null>(null)
  // Available desktop sources (screens/windows) for Electron
  const availableDesktopSources = ref<Array<{ id: string, name: string, thumbnail: string, type: 'screen' | 'window' }>>([])
  const isLoadingDesktopSources = ref(false)

  // Internal state for continuous capture
  let captureIntervalId: ReturnType<typeof setInterval> | null = null

  // Computed properties
  const availableProvidersMetadata = computed(() => {
    // Return all configured chat providers (they may support vision)
    return configuredChatProvidersMetadata.value
  })

  const allVisionProvidersMetadata = computed(() => {
    // All chat providers could potentially support vision
    return allChatProvidersMetadata.value
  })

  const supportsModelListing = computed(() => {
    if (!activeVisionProvider.value)
      return false
    return providersStore.getProviderMetadata(activeVisionProvider.value)?.capabilities.listModels !== undefined
  })

  const providerModels = computed(() => {
    if (!activeVisionProvider.value)
      return []
    return providersStore.getModelsForProvider(activeVisionProvider.value) || []
  })

  /**
   * Filter models to show only vision-capable ones
   */
  const visionCapableModels = computed(() => {
    const models = providerModels.value || []
    return models.filter((model) => {
      const modelId = model.id.toLowerCase()
      return VISION_CAPABLE_MODEL_PATTERNS.some(pattern => modelId.includes(pattern.toLowerCase()))
    })
  })

  const isLoadingActiveProviderModels = computed(() => {
    return providersStore.isLoadingModels[activeVisionProvider.value] || false
  })

  const activeProviderModelError = computed(() => {
    return providersStore.modelLoadError[activeVisionProvider.value] || null
  })

  const configured = computed(() => {
    return !!activeVisionProvider.value && !!activeVisionModel.value
  })

  // Methods
  async function loadModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined) {
      await providersStore.fetchModelsForProvider(provider)
    }
  }

  async function getModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined) {
      return providersStore.getModelsForProvider(provider)
    }
    return []
  }

  function resetState() {
    stopContinuousCapture()
    stopCapture()
    resetActiveVisionProvider()
    resetActiveVisionModel()
    resetActiveCustomModelName()
    resetVisionModelSearchQuery()
    resetCaptureSource()
    resetAnalysisMode()
    resetCaptureIntervalMs()
    resetCompressionQuality()
    resetMaxImageWidth()
    resetMaxImageHeight()
    resetSelectedDesktopSourceId()
    lastAnalysisResult.value = null
    analysisError.value = null
    previewImageDataUrl.value = null
  }

  /**
   * Check if we're running in Electron
   */
  function isElectron(): boolean {
    return typeof window !== 'undefined' && 'electron' in window
  }

  /**
   * Get the Electron API if available
   */
  function getElectronApi(): { ipcRenderer: { invoke: (channel: string, ...args: any[]) => Promise<any> } } | null {
    if (!isElectron()) {
      return null
    }
    return (window as any).electron
  }

  /**
   * Get available desktop sources (screens and windows) in Electron
   * This must be called before screen/window capture in Electron
   */
  async function fetchDesktopSources(): Promise<void> {
    const electronApi = getElectronApi()
    if (!electronApi) {
      return
    }

    isLoadingDesktopSources.value = true
    try {
      // Use raw IPC invoke with direct channel name
      // NOTICE: This matches the ipcMain.handle channel in stage-tamagotchi/src/main/services/electron/screen.ts
      const sources = await electronApi.ipcRenderer.invoke('electron.screen.getDesktopSources', {
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      })

      availableDesktopSources.value = sources.map((source: any) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail,
        type: source.id.startsWith('screen:') ? 'screen' as const : 'window' as const,
      }))
    }
    catch (error) {
      console.error('Failed to fetch desktop sources:', error)
      availableDesktopSources.value = []
    }
    finally {
      isLoadingDesktopSources.value = false
    }
  }

  /**
   * Request screen/camera capture permission and start stream
   */
  async function startCapture(): Promise<boolean> {
    try {
      stopCapture()
      analysisError.value = null

      if (captureSource.value === 'screen' || captureSource.value === 'window') {
        // Screen/window capture
        if (isElectron()) {
          // In Electron, use desktopCapturer via getUserMedia with chromeMediaSource
          if (!selectedDesktopSourceId.value) {
            // Fetch available sources if not already done
            await fetchDesktopSources()
            if (availableDesktopSources.value.length === 0) {
              analysisError.value = 'No screen or window sources available.'
              return false
            }
            // Select first available source of the correct type
            const sourceType = captureSource.value === 'screen' ? 'screen' : 'window'
            const defaultSource = availableDesktopSources.value.find(s => s.type === sourceType)
              || availableDesktopSources.value[0]
            selectedDesktopSourceId.value = defaultSource.id
          }

          try {
            // NOTICE: In Electron, we use getUserMedia with mandatory chromeMediaSource
            currentStream.value = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: selectedDesktopSourceId.value,
                  maxWidth: maxImageWidth.value,
                  maxHeight: maxImageHeight.value,
                },
              } as any,
            })
          }
          catch (electronError) {
            const errorMessage = electronError instanceof Error ? electronError.message : 'Unknown error'
            console.error('Electron screen capture failed:', electronError)
            analysisError.value = `Screen capture failed: ${errorMessage}. Try selecting a different source.`
            return false
          }
        }
        else {
          // Web browser - use getDisplayMedia
          if (!navigator.mediaDevices?.getDisplayMedia) {
            analysisError.value = 'Screen capture is not supported in this browser.'
            return false
          }

          try {
            currentStream.value = await navigator.mediaDevices.getDisplayMedia({
              video: {
                width: { ideal: maxImageWidth.value },
                height: { ideal: maxImageHeight.value },
              },
            })
          }
          catch (displayError) {
            const errorMessage = displayError instanceof Error ? displayError.message : 'Unknown error'
            if (errorMessage.includes('NotAllowedError') || errorMessage.includes('Permission denied')) {
              analysisError.value = 'Screen capture was denied. Please allow screen sharing permissions.'
            }
            else {
              analysisError.value = `Screen capture failed: ${errorMessage}`
            }
            return false
          }
        }
      }
      else if (captureSource.value === 'camera') {
        // Camera capture - works in both Electron and web
        if (!navigator.mediaDevices?.getUserMedia) {
          analysisError.value = 'Camera access is not supported in this environment.'
          return false
        }

        try {
          currentStream.value = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: maxImageWidth.value },
              height: { ideal: maxImageHeight.value },
            },
          })
        }
        catch (cameraError) {
          const errorMessage = cameraError instanceof Error ? cameraError.message : 'Unknown error'
          if (errorMessage.includes('NotAllowedError') || errorMessage.includes('Permission denied')) {
            analysisError.value = 'Camera access was denied. Please allow camera permissions and try again.'
          }
          else if (errorMessage.includes('NotFoundError')) {
            analysisError.value = 'No camera found. Please connect a camera and try again.'
          }
          else {
            analysisError.value = `Camera capture failed: ${errorMessage}`
          }
          return false
        }
      }

      if (!currentStream.value) {
        analysisError.value = 'Failed to start capture stream.'
        return false
      }

      isCapturing.value = true
      return true
    }
    catch (error) {
      console.error('Failed to start capture:', error)
      analysisError.value = `Failed to start capture: ${error instanceof Error ? error.message : 'Unknown error'}`
      return false
    }
  }

  /**
   * Stop the current capture stream
   */
  function stopCapture() {
    if (currentStream.value) {
      currentStream.value.getTracks().forEach(track => track.stop())
      currentStream.value = null
    }
    isCapturing.value = false
    previewImageDataUrl.value = null
  }

  /**
   * Capture a single frame from the current stream and return as base64
   */
  async function captureFrame(options?: CaptureOptions): Promise<string | null> {
    if (!currentStream.value) {
      analysisError.value = 'No capture stream available. Start capture first.'
      return null
    }

    const opts = { ...DEFAULT_CAPTURE_OPTIONS, ...options }

    try {
      const video = document.createElement('video')
      video.srcObject = currentStream.value
      video.muted = true
      await video.play()

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve()
        }
        else {
          video.onloadeddata = () => resolve()
        }
      })

      // Calculate scaled dimensions maintaining aspect ratio
      let width = video.videoWidth
      let height = video.videoHeight

      if (width > opts.maxWidth) {
        height = Math.round((height * opts.maxWidth) / width)
        width = opts.maxWidth
      }
      if (height > opts.maxHeight) {
        width = Math.round((width * opts.maxHeight) / height)
        height = opts.maxHeight
      }

      // Draw to canvas and export as JPEG
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }

      ctx.drawImage(video, 0, 0, width, height)
      video.pause()
      video.srcObject = null

      const dataUrl = canvas.toDataURL('image/jpeg', opts.quality ?? compressionQuality.value)
      previewImageDataUrl.value = dataUrl

      return dataUrl
    }
    catch (error) {
      console.error('Failed to capture frame:', error)
      analysisError.value = `Failed to capture frame: ${error instanceof Error ? error.message : 'Unknown error'}`
      return null
    }
  }

  /**
   * Analyze an image using the configured vision LLM
   */
  async function analyzeImage(
    imageDataUrl: string,
    prompt?: string,
  ): Promise<VisionAnalysisResult | null> {
    if (!activeVisionProvider.value || !activeVisionModel.value) {
      analysisError.value = 'Vision provider and model must be configured'
      return null
    }

    isAnalyzing.value = true
    analysisError.value = null

    try {
      const provider = await providersStore.getProviderInstance(activeVisionProvider.value) as ChatProvider
      if (!provider) {
        throw new Error('Failed to get provider instance')
      }

      const modelToUse = activeCustomModelName.value || activeVisionModel.value

      const systemPrompt = prompt ?? `You are AIRI's vision system. Describe what you see in this image concisely but comprehensively.
Focus on:
- What application or content is visible
- Any text or code that appears
- The general activity or context
- Anything notable or interesting

Keep your response brief (2-3 sentences) unless there's something particularly important to note.`

      // NOTICE: Only spread provider.chat() config, not raw providerConfig
      // provider.chat() already includes baseURL and apiKey
      const res = await generateText({
        ...provider.chat(modelToUse),
        messages: message.messages(
          message.system(systemPrompt),
          message.user([message.imagePart(imageDataUrl)]),
        ),
      })

      const result: VisionAnalysisResult = {
        timestamp: Date.now(),
        description: res.text ?? '',
      }

      lastAnalysisResult.value = result
      return result
    }
    catch (error) {
      console.error('Vision analysis failed:', error)
      analysisError.value = `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      return null
    }
    finally {
      isAnalyzing.value = false
    }
  }

  /**
   * Capture a frame and analyze it in one call
   */
  async function captureAndAnalyze(prompt?: string): Promise<VisionAnalysisResult | null> {
    const imageDataUrl = await captureFrame()
    if (!imageDataUrl) {
      return null
    }
    return analyzeImage(imageDataUrl, prompt)
  }

  /**
   * Start continuous capture and analysis
   */
  function startContinuousCapture() {
    if (analysisMode.value !== 'continuous') {
      return
    }

    stopContinuousCapture()

    captureIntervalId = setInterval(async () => {
      if (!isAnalyzing.value && isCapturing.value) {
        await captureAndAnalyze()
      }
    }, captureIntervalMs.value)
  }

  /**
   * Stop continuous capture
   */
  function stopContinuousCapture() {
    if (captureIntervalId) {
      clearInterval(captureIntervalId)
      captureIntervalId = null
    }
  }

  /**
   * Check if a model ID is likely vision-capable
   */
  function isVisionCapableModel(modelId: string): boolean {
    const modelIdLower = modelId.toLowerCase()
    return VISION_CAPABLE_MODEL_PATTERNS.some(pattern => modelIdLower.includes(pattern.toLowerCase()))
  }

  return {
    // Provider/Model State
    activeVisionProvider,
    activeVisionModel,
    activeCustomModelName,
    visionModelSearchQuery,
    availableProvidersMetadata,
    allVisionProvidersMetadata,
    supportsModelListing,
    providerModels,
    visionCapableModels,
    isLoadingActiveProviderModels,
    activeProviderModelError,
    configured,

    // Capture Settings
    captureSource,
    analysisMode,
    captureIntervalMs,
    compressionQuality,
    maxImageWidth,
    maxImageHeight,

    // Desktop Sources (Electron)
    selectedDesktopSourceId,
    availableDesktopSources,
    isLoadingDesktopSources,

    // State
    isCapturing,
    isAnalyzing,
    lastAnalysisResult,
    analysisError,
    currentStream,
    previewImageDataUrl,

    // Methods
    loadModelsForProvider,
    getModelsForProvider,
    resetState,
    startCapture,
    stopCapture,
    captureFrame,
    analyzeImage,
    captureAndAnalyze,
    startContinuousCapture,
    stopContinuousCapture,
    isVisionCapableModel,
    fetchDesktopSources,
    isElectron,
  }
})
