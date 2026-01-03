<script setup lang="ts">
import {
  SpeechPlayground,
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const speechStore = useSpeechStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore)
const { t } = useI18n()

const providerId = 'google-cloud-tts'

// Voice type options with free tier information
// NOTICE: Gemini TTS (Gemini 2.5 Flash/Pro) does NOT have free tier and uses different API
const voiceTypeOptions = [
  { label: 'Standard (Free: 4M chars/month)', value: 'Standard' },
  { label: 'WaveNet (Free: 4M chars/month)', value: 'Wavenet' },
  { label: 'Neural2 (Free: 1M chars/month)', value: 'Neural2' },
  { label: 'Studio (Free: 1M chars/month)', value: 'Studio' },
  { label: 'Chirp 3 HD (Free: 1M chars/month)', value: 'Chirp3-HD' },
  { label: 'Journey (Free: 1M chars/month)', value: 'Journey' },
]

// Audio encoding options
const audioEncodingOptions = [
  { label: 'MP3', value: 'MP3' },
  { label: 'OGG Opus', value: 'OGG_OPUS' },
  { label: 'WAV (Linear PCM 16-bit)', value: 'LINEAR16' },
]

// Selected voice type filter
const selectedVoiceType = ref<string>('Standard')
const selectedAudioEncoding = ref<string>('MP3')

// Check if API key is configured
const apiKeyConfigured = computed(() => !!providers.value[providerId]?.apiKey)

// Get all voices and filter by selected type
const allVoices = computed(() => {
  return speechStore.availableVoices[providerId] || []
})

// Filter voices by selected voice type
const availableVoices = computed(() => {
  const voices = allVoices.value
  if (!selectedVoiceType.value)
    return voices

  return voices.filter((voice) => {
    const voiceName = voice.id || voice.name
    return voiceName.includes(selectedVoiceType.value)
  })
})

/**
 * Extract language code from voice name
 * Voice names follow pattern: {language}-{type}-{name}
 * e.g., en-US-Standard-A -> en-US
 */
function extractLanguageCode(voiceName: string): string {
  // Match patterns like en-US, ja-JP, cmn-CN, etc.
  const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})/)
  return match ? match[1] : 'en-US'
}

/**
 * Check if voice is a Chirp 3 HD voice that doesn't support SSML
 * NOTICE: Chirp 3 HD voices do NOT support SSML input per Google docs
 */
function isChirp3HDVoice(voiceName: string): boolean {
  return voiceName.includes('Chirp3-HD') || voiceName.includes('Chirp-HD')
}

/**
 * Determine if this voice requires a model name
 * NOTICE: Certain voice types (Chirp 3 HD, Journey, Studio, Polyglot) require the 'model' field
 * at the TOP LEVEL of the request body (NOT inside audioConfig)
 */
function getModelForVoice(voiceName: string): string | null {
  const voiceUpper = voiceName.toUpperCase()
  if (voiceUpper.includes('CHIRP3-HD') || voiceUpper.includes('CHIRP-HD'))
    return 'chirp3-hd'
  if (voiceUpper.includes('CHIRP'))
    return 'chirp'
  if (voiceUpper.includes('JOURNEY'))
    return 'journey'
  if (voiceUpper.includes('STUDIO'))
    return 'studio'
  if (voiceUpper.includes('POLYGLOT'))
    return 'polyglot'
  // Standard, WaveNet, Neural2 voices don't require model field
  return null
}

/**
 * Generate speech using Google Cloud Text-to-Speech API
 * Reference: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 *
 * NOTICE: The voice type/model is embedded in the voice name (e.g., en-US-Chirp3-HD-Charon)
 * The 'model' field must be at the TOP LEVEL of the request body when required
 */
async function handleGenerateSpeech(input: string, voiceId: string, useSSML: boolean): Promise<ArrayBuffer> {
  const providerConfig = providersStore.getProviderConfig(providerId)
  const apiKey = providerConfig.apiKey as string
  const baseUrl = (providerConfig.baseUrl as string) || 'https://texttospeech.googleapis.com/v1/'

  if (!apiKey) {
    throw new Error('API Key is required. Get one at https://console.cloud.google.com/apis/credentials')
  }

  // Extract language code from voice name
  const languageCode = extractLanguageCode(voiceId)

  // NOTICE: Chirp 3 HD voices do NOT support SSML input
  const isChirp3HD = isChirp3HDVoice(voiceId)
  const effectiveUseSSML = useSSML && !isChirp3HD

  // Determine if this voice requires a model field
  const model = getModelForVoice(voiceId)

  // Build the Google Cloud TTS API request
  // Reference: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
  // NOTICE: 'model' field is at TOP LEVEL when required, NOT inside audioConfig
  const requestBody: Record<string, unknown> = {
    input: effectiveUseSSML ? { ssml: input } : { text: input },
    voice: {
      languageCode,
      name: voiceId,
    },
    audioConfig: {
      audioEncoding: selectedAudioEncoding.value || 'MP3',
    },
  }

  // Add model at top level if required by the voice type
  if (model) {
    requestBody.model = model
  }

  const url = `${baseUrl}text:synthesize?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Cloud TTS API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as { audioContent: string }

  // The audio is returned as base64 encoded audio with headers included
  const audioContent = data.audioContent
  if (!audioContent) {
    throw new Error('No audio content in response')
  }

  // Decode base64 to ArrayBuffer
  const binaryString = atob(audioContent)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return bytes.buffer
}

// Load voices when provider config changes
watch(providers, async () => {
  const providerConfig = providersStore.getProviderConfig(providerId)
  const providerMetadata = providersStore.getProviderMetadata(providerId)
  if (await providerMetadata.validators.validateProviderConfig(providerConfig)) {
    await speechStore.loadVoicesForProvider(providerId)
  }
}, { immediate: true })

// Save audio encoding to provider config
watch(selectedAudioEncoding, () => {
  const providerConfig = providersStore.getProviderConfig(providerId)
  providerConfig.audioEncoding = selectedAudioEncoding.value
})

onMounted(async () => {
  const providerConfig = providersStore.getProviderConfig(providerId)
  // Load saved audio encoding
  if (providerConfig.audioEncoding) {
    selectedAudioEncoding.value = providerConfig.audioEncoding as string
  }
})
</script>

<template>
  <SpeechProviderSettings :provider-id="providerId">
    <!-- Voice type and audio settings -->
    <template #voice-settings>
      <div :class="['flex', 'flex-col', 'gap-4']">
        <!-- Voice Type Selection -->
        <FieldSelect
          v-model="selectedVoiceType"
          :label="t('settings.pages.providers.provider.google-cloud-tts.fields.field.voiceType.label', 'Voice Type')"
          :description="t('settings.pages.providers.provider.google-cloud-tts.fields.field.voiceType.description', 'Select voice type (affects quality and free tier quota)')"
          :options="voiceTypeOptions"
          placeholder="Select voice type"
        />

        <!-- Audio Encoding Selection -->
        <FieldSelect
          v-model="selectedAudioEncoding"
          :label="t('settings.pages.providers.provider.google-cloud-tts.fields.field.audioEncoding.label', 'Audio Format')"
          :description="t('settings.pages.providers.provider.google-cloud-tts.fields.field.audioEncoding.description', 'Output audio format')"
          :options="audioEncodingOptions"
          placeholder="Select audio format"
        />

        <!-- Free tier info -->
        <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400', 'p-2', 'rounded', 'bg-neutral-100', 'dark:bg-neutral-800']">
          <div :class="['font-medium', 'mb-1']">
            Free Tier (per month):
          </div>
          <ul :class="['list-disc', 'list-inside', 'space-y-0.5']">
            <li>Standard & WaveNet: 4 million characters</li>
            <li>Neural2, Studio, Chirp 3 HD: 1 million characters</li>
          </ul>
          <div :class="['mt-2', 'text-amber-600', 'dark:text-amber-400']">
            ⚠️ Gemini TTS (2.5 Flash/Pro) has NO free tier and uses a different API
          </div>
        </div>
      </div>
    </template>

    <template #playground>
      <SpeechPlayground
        :available-voices="availableVoices"
        :generate-speech="handleGenerateSpeech"
        :api-key-configured="apiKeyConfigured"
        default-text="Hello! This is a test of Google Cloud Text-to-Speech."
      />
    </template>
  </SpeechProviderSettings>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
