<script setup lang="ts">
import { Alert, ErrorContainer, RadioCardManySelect, RadioCardSimple, TestDummyMarker } from '@proj-airi/stage-ui/components'
import { useAnalytics } from '@proj-airi/stage-ui/composables'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { trackProviderClick } = useAnalytics()

const visionStore = useVisionStore()
const {
  activeVisionProvider,
  activeVisionModel,
  activeCustomModelName,
  visionModelSearchQuery,
  providerModels,
  visionCapableModels,
  activeProviderModelError,
  isLoadingActiveProviderModels,
  supportsModelListing,
  captureSource,
  analysisMode,
  captureIntervalMs,
  compressionQuality,
  isCapturing,
  isAnalyzing,
  lastAnalysisResult,
  analysisError,
  previewImageDataUrl,
  configured,
  // Desktop source selection (Electron)
  selectedDesktopSourceId,
  availableDesktopSources,
  isLoadingDesktopSources,
} = storeToRefs(visionStore)

// Check if running in Electron
const isElectronApp = visionStore.isElectron()

const providersStore = useProvidersStore()
const { configuredChatProvidersMetadata } = storeToRefs(providersStore)

// Safeguard for providers list
const safeConfiguredProviders = computed(() => configuredChatProvidersMetadata.value || [])

// Local state
const showAllModels = ref(false)

// Models to display (filtered or all)
const displayedModels = computed(() => {
  const allModels = providerModels.value || []
  const visionModels = visionCapableModels.value || []

  if (showAllModels.value) {
    return allModels
  }
  // Show vision-capable models, or all if none match the filter
  return visionModels.length > 0 ? visionModels : allModels
})

const hasNonVisionModels = computed(() => {
  const allModels = providerModels.value || []
  const visionModels = visionCapableModels.value || []
  return allModels.length > visionModels.length
})

function updateCustomModelName(value: string) {
  activeCustomModelName.value = value
}

async function handleStartCapture() {
  const success = await visionStore.startCapture()
  if (success && analysisMode.value === 'continuous') {
    visionStore.startContinuousCapture()
  }
}

function handleStopCapture() {
  visionStore.stopContinuousCapture()
  visionStore.stopCapture()
}

async function handleCaptureAndAnalyze() {
  await visionStore.captureAndAnalyze()
}

async function handleTestVision() {
  if (!isCapturing.value) {
    const success = await visionStore.startCapture()
    if (!success)
      return
  }
  await visionStore.captureAndAnalyze()
}

// Load desktop sources when capture source changes to screen/window in Electron
async function loadDesktopSources() {
  if (isElectronApp && (captureSource.value === 'screen' || captureSource.value === 'window')) {
    await visionStore.fetchDesktopSources()
  }
}

// Watch for provider changes to load models
watch(activeVisionProvider, async (newProvider, oldProvider) => {
  if (newProvider && newProvider !== oldProvider) {
    try {
      await visionStore.loadModelsForProvider(newProvider)
    }
    catch (error) {
      console.error('Failed to load models for provider:', error)
    }
  }
}, { immediate: false })

// Watch for analysis mode changes
watch(analysisMode, (newMode) => {
  if (newMode === 'continuous' && isCapturing.value) {
    visionStore.startContinuousCapture()
  }
  else {
    visionStore.stopContinuousCapture()
  }
})

// Watch for capture source changes to load desktop sources in Electron
watch(captureSource, async (newSource) => {
  if (isElectronApp && (newSource === 'screen' || newSource === 'window')) {
    await visionStore.fetchDesktopSources()
  }
}, { immediate: true })

onMounted(async () => {
  if (activeVisionProvider.value) {
    try {
      await visionStore.loadModelsForProvider(activeVisionProvider.value)
    }
    catch (error) {
      console.error('Failed to load models for provider on mount:', error)
    }
  }
})

onUnmounted(() => {
  visionStore.stopContinuousCapture()
  // Don't stop capture on unmount - user may want to keep it running
})
</script>

<template>
  <div flex="~ col md:row gap-6">
    <!-- Left Panel: Settings -->
    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4" class="h-fit w-full md:w-[40%]">
      <div flex="~ col gap-4">
        <!-- Provider Selection -->
        <div flex="~ col gap-4">
          <div>
            <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
              {{ t('settings.pages.providers.title', 'Provider') }}
            </h2>
            <div text="neutral-400 dark:neutral-400">
              <span>{{ t('settings.pages.modules.vision.provider-description', 'Select a chat provider with vision capabilities') }}</span>
            </div>
          </div>

          <div max-w-full>
            <fieldset
              v-if="safeConfiguredProviders.length > 0"
              flex="~ row gap-4"
              :style="{ 'scrollbar-width': 'none' }"
              min-w-0 of-x-scroll scroll-smooth
              role="radiogroup"
            >
              <RadioCardSimple
                v-for="metadata in safeConfiguredProviders"
                :id="metadata.id"
                :key="metadata.id"
                v-model="activeVisionProvider"
                name="vision-provider"
                :value="metadata.id"
                :title="metadata.localizedName || 'Unknown'"
                :description="metadata.localizedDescription"
                @click="trackProviderClick(metadata.id, 'vision')"
              />
              <RouterLink
                to="/settings/providers#chat"
                border="2px solid"
                class="border-neutral-100 bg-white dark:border-neutral-900 hover:border-primary-500/30 dark:bg-neutral-900/20 dark:hover:border-primary-400/30"
                flex="~ col items-center justify-center"
                transition="all duration-200 ease-in-out"
                relative min-w-50 w-fit rounded-xl p-4
              >
                <div i-solar:add-circle-line-duotone class="text-2xl text-neutral-500 dark:text-neutral-500" />
                <div
                  class="bg-dotted-neutral-200/80 dark:bg-dotted-neutral-700/50"
                  absolute inset-0 z--1
                  style="background-size: 10px 10px; mask-image: linear-gradient(165deg, white 30%, transparent 50%);"
                />
              </RouterLink>
            </fieldset>
            <div v-else>
              <RouterLink
                class="flex items-center gap-3 rounded-lg p-4"
                border="2 dashed neutral-200 dark:neutral-800"
                bg="neutral-50 dark:neutral-800"
                transition="colors duration-200 ease-in-out"
                to="/settings/providers"
              >
                <div i-solar:warning-circle-line-duotone class="text-2xl text-amber-500 dark:text-amber-400" />
                <div class="flex flex-col">
                  <span class="font-medium">{{ t('settings.pages.modules.vision.no-providers', 'No Providers Configured') }}</span>
                  <span class="text-sm text-neutral-400 dark:text-neutral-500">{{ t('settings.pages.modules.vision.no-providers-hint', 'Click here to set up your Chat providers') }}</span>
                </div>
                <div i-solar:arrow-right-line-duotone class="ml-auto text-xl text-neutral-400 dark:text-neutral-500" />
              </RouterLink>
            </div>
          </div>
        </div>

        <!-- Model Selection -->
        <div v-if="activeVisionProvider && supportsModelListing" flex="~ col gap-4">
          <div>
            <h2 class="text-lg md:text-2xl">
              {{ t('settings.pages.modules.vision.model-selection.title', 'Model') }}
            </h2>
            <div text="neutral-400 dark:neutral-400">
              <span>{{ t('settings.pages.modules.vision.model-selection.description', 'Select a vision-capable model') }}</span>
            </div>
          </div>

          <!-- Loading state -->
          <div v-if="isLoadingActiveProviderModels" class="flex items-center justify-center py-4">
            <div class="mr-2 animate-spin">
              <div i-solar:spinner-line-duotone text-xl />
            </div>
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.loading', 'Loading models...') }}</span>
          </div>

          <!-- Error state -->
          <ErrorContainer
            v-else-if="activeProviderModelError"
            :title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.error', 'Error loading models')"
            :error="activeProviderModelError"
          />

          <!-- No models available -->
          <Alert
            v-else-if="providerModels.length === 0 && !isLoadingActiveProviderModels"
            type="warning"
          >
            <template #title>
              {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models', 'No models available') }}
            </template>
            <template #content>
              {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models_description', 'No models were found for this provider') }}
            </template>
          </Alert>

          <!-- Model list -->
          <template v-else-if="providerModels.length > 0">
            <!-- Vision filter toggle -->
            <div v-if="hasNonVisionModels" class="flex items-center gap-2 text-sm">
              <button
                :class="[
                  'rounded-full',
                  'px-3',
                  'py-1',
                  'transition-colors',
                  !showAllModels ? 'bg-primary-500 text-white' : 'bg-neutral-200 dark:bg-neutral-700',
                ]"
                @click="showAllModels = false"
              >
                {{ t('settings.pages.modules.vision.model-selection.vision-only', 'Vision Models') }}
              </button>
              <button
                :class="[
                  'rounded-full',
                  'px-3',
                  'py-1',
                  'transition-colors',
                  showAllModels ? 'bg-primary-500 text-white' : 'bg-neutral-200 dark:bg-neutral-700',
                ]"
                @click="showAllModels = true"
              >
                {{ t('settings.pages.modules.vision.model-selection.all-models', 'All Models') }}
              </button>
            </div>

            <RadioCardManySelect
              v-model="activeVisionModel"
              v-model:search-query="visionModelSearchQuery"
              :items="[...displayedModels].sort((a, b) => a.id === activeVisionModel ? -1 : b.id === activeVisionModel ? 1 : 0)"
              :searchable="true"
              :search-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_placeholder', 'Search models...')"
              :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results', 'No results')"
              :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: visionModelSearchQuery })"
              :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
              :custom-input-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.custom_model_placeholder', 'Enter custom model name...')"
              :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand', 'Show more')"
              :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse', 'Show less')"
              @update:custom-value="updateCustomModelName"
            />
          </template>
        </div>

        <!-- Capture Settings -->
        <div v-if="configured" flex="~ col gap-4">
          <div>
            <h2 class="text-lg md:text-2xl">
              {{ t('settings.pages.modules.vision.capture-settings.title', 'Capture Settings') }}
            </h2>
          </div>

          <!-- Capture Source -->
          <div :class="['flex', 'flex-col', 'gap-2']">
            <div>
              <div :class="['text-sm', 'font-medium']">
                {{ t('settings.pages.modules.vision.capture-source.label', 'Capture Source') }}
              </div>
              <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
                {{ t('settings.pages.modules.vision.capture-source.description', 'Choose what AIRI can see') }}
              </div>
            </div>
            <select
              v-model="captureSource"
              :class="[
                'w-full',
                'px-3',
                'py-2',
                'rounded-lg',
                'border',
                'border-neutral-200',
                'dark:border-neutral-700',
                'bg-white',
                'dark:bg-neutral-800',
                'text-sm',
                'focus:outline-none',
                'focus:ring-2',
                'focus:ring-primary-500',
              ]"
            >
              <option value="screen">{{ t('settings.pages.modules.vision.capture-source.screen', 'Screen Share') }}</option>
              <option value="camera">{{ t('settings.pages.modules.vision.capture-source.camera', 'Camera / Webcam') }}</option>
              <option value="window">{{ t('settings.pages.modules.vision.capture-source.window', 'Specific Window (Desktop)') }}</option>
            </select>
          </div>

          <!-- Desktop Source Selection (Electron only) -->
          <div
            v-if="isElectronApp && (captureSource === 'screen' || captureSource === 'window')"
            :class="['flex', 'flex-col', 'gap-2']"
          >
            <div>
              <div :class="['text-sm', 'font-medium']">
                {{ captureSource === 'screen'
                  ? t('settings.pages.modules.vision.desktop-source.screen-label', 'Select Screen')
                  : t('settings.pages.modules.vision.desktop-source.window-label', 'Select Window') }}
              </div>
              <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
                {{ t('settings.pages.modules.vision.desktop-source.description', 'Choose which screen or window to capture') }}
              </div>
            </div>

            <!-- Loading state -->
            <div v-if="isLoadingDesktopSources" :class="['flex', 'items-center', 'gap-2', 'py-2']">
              <div :class="['animate-spin']">
                <div i-solar:spinner-line-duotone text-lg />
              </div>
              <span :class="['text-sm', 'text-neutral-500']">
                {{ t('settings.pages.modules.vision.desktop-source.loading', 'Loading available sources...') }}
              </span>
            </div>

            <!-- Source grid with thumbnails -->
            <div
              v-else-if="availableDesktopSources.length > 0"
              :class="['grid', 'grid-cols-2', 'gap-2', 'max-h-48', 'overflow-y-auto', 'p-1']"
              style="scrollbar-width: thin;"
            >
              <button
                v-for="source in availableDesktopSources.filter(s =>
                  captureSource === 'screen' ? s.type === 'screen' : s.type === 'window'
                )"
                :key="source.id"
                :class="[
                  'flex',
                  'flex-col',
                  'items-center',
                  'gap-1',
                  'p-2',
                  'rounded-lg',
                  'border-2',
                  'transition-all',
                  'cursor-pointer',
                  'hover:border-primary-400',
                  selectedDesktopSourceId === source.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800',
                ]"
                @click="selectedDesktopSourceId = source.id"
              >
                <img
                  v-if="source.thumbnail"
                  :src="source.thumbnail"
                  :alt="source.name"
                  :class="['w-full', 'h-16', 'object-cover', 'rounded', 'border', 'border-neutral-200', 'dark:border-neutral-600']"
                >
                <div
                  v-else
                  :class="['w-full', 'h-16', 'rounded', 'bg-neutral-200', 'dark:bg-neutral-700', 'flex', 'items-center', 'justify-center']"
                >
                  <div i-solar:monitor-line-duotone :class="['text-2xl', 'text-neutral-400']" />
                </div>
                <span :class="['text-xs', 'text-center', 'line-clamp-1', 'w-full']" :title="source.name">
                  {{ source.name }}
                </span>
              </button>
            </div>

            <!-- No sources available -->
            <div
              v-else
              :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400', 'py-2']"
            >
              {{ t('settings.pages.modules.vision.desktop-source.no-sources', 'No screens or windows available') }}
            </div>

            <!-- Refresh button -->
            <button
              :class="[
                'text-xs',
                'text-primary-500',
                'hover:text-primary-600',
                'flex',
                'items-center',
                'gap-1',
                'self-start',
              ]"
              :disabled="isLoadingDesktopSources"
              @click="loadDesktopSources"
            >
              <div i-solar:refresh-line-duotone :class="['text-sm', isLoadingDesktopSources ? 'animate-spin' : '']" />
              {{ t('settings.pages.modules.vision.desktop-source.refresh', 'Refresh sources') }}
            </button>
          </div>

          <!-- Analysis Mode -->
          <div :class="['flex', 'flex-col', 'gap-2']">
            <div>
              <div :class="['text-sm', 'font-medium']">
                {{ t('settings.pages.modules.vision.analysis-mode.label', 'Analysis Mode') }}
              </div>
              <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
                {{ t('settings.pages.modules.vision.analysis-mode.description', 'How often should AIRI analyze what it sees') }}
              </div>
            </div>
            <select
              v-model="analysisMode"
              :class="[
                'w-full',
                'px-3',
                'py-2',
                'rounded-lg',
                'border',
                'border-neutral-200',
                'dark:border-neutral-700',
                'bg-white',
                'dark:bg-neutral-800',
                'text-sm',
                'focus:outline-none',
                'focus:ring-2',
                'focus:ring-primary-500',
              ]"
            >
              <option value="on-demand">{{ t('settings.pages.modules.vision.analysis-mode.on-demand', 'On-Demand (Manual)') }}</option>
              <option value="continuous">{{ t('settings.pages.modules.vision.analysis-mode.continuous', 'Continuous (Auto)') }}</option>
            </select>
          </div>

          <!-- Capture Interval (only for continuous mode) -->
          <div v-if="analysisMode === 'continuous'" :class="['flex', 'flex-col', 'gap-2']">
            <div>
              <div :class="['text-sm', 'font-medium']">
                {{ t('settings.pages.modules.vision.capture-interval.label', 'Capture Interval') }}
              </div>
              <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
                {{ t('settings.pages.modules.vision.capture-interval.description', 'How often to capture and analyze') }}
              </div>
            </div>
            <select
              v-model="captureIntervalMs"
              :class="[
                'w-full',
                'px-3',
                'py-2',
                'rounded-lg',
                'border',
                'border-neutral-200',
                'dark:border-neutral-700',
                'bg-white',
                'dark:bg-neutral-800',
                'text-sm',
                'focus:outline-none',
                'focus:ring-2',
                'focus:ring-primary-500',
              ]"
            >
              <option :value="2000">2 seconds</option>
              <option :value="5000">5 seconds</option>
              <option :value="10000">10 seconds</option>
              <option :value="30000">30 seconds</option>
              <option :value="60000">1 minute</option>
            </select>
          </div>

          <!-- Compression Quality -->
          <FieldRange
            v-model="compressionQuality"
            :label="t('settings.pages.modules.vision.compression.label', 'Image Quality')"
            :description="t('settings.pages.modules.vision.compression.description', 'Lower quality = smaller size = faster & cheaper')"
            :min="0.3"
            :max="1"
            :step="0.1"
          />
        </div>

        <!-- Info Box -->
        <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400', 'p-3', 'rounded-lg', 'bg-neutral-200/50', 'dark:bg-neutral-800/50']">
          <div :class="['font-medium', 'mb-2', 'flex', 'items-center', 'gap-2']">
            <div i-solar:info-circle-line-duotone />
            {{ t('settings.pages.modules.vision.info.title', 'Privacy Note') }}
          </div>
          <ul :class="['list-disc', 'list-inside', 'space-y-1']">
            <li>{{ t('settings.pages.modules.vision.info.point1', 'Images are processed in memory only') }}</li>
            <li>{{ t('settings.pages.modules.vision.info.point2', 'Images are NOT saved to disk') }}</li>
            <li>{{ t('settings.pages.modules.vision.info.point3', 'Images are sent to your chosen provider API') }}</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Right Panel: Preview & Test -->
    <div flex="~ col gap-6" class="w-full md:w-[60%]">
      <div w-full rounded-xl>
        <h2 class="mb-4 text-lg text-neutral-500 md:text-2xl dark:text-neutral-400" w-full>
          <div class="inline-flex items-center gap-4">
            <TestDummyMarker />
            <div>
              {{ t('settings.pages.modules.vision.test.title', 'Vision Test') }}
            </div>
          </div>
        </h2>

        <!-- Not configured warning -->
        <Alert v-if="!configured" type="warning">
          <template #title>
            {{ t('settings.pages.modules.vision.test.not-configured', 'Vision Not Configured') }}
          </template>
          <template #content>
            {{ t('settings.pages.modules.vision.test.not-configured-hint', 'Please select a provider and model to test vision') }}
          </template>
        </Alert>

        <!-- Test area -->
        <div v-else flex="~ col gap-4">
          <!-- Control buttons -->
          <div flex="~ row gap-3 wrap">
            <Button
              v-if="!isCapturing"
              :class="['flex', 'items-center', 'gap-2']"
              @click="handleStartCapture"
            >
              <div i-solar:play-bold />
              {{ t('settings.pages.modules.vision.test.start-capture', 'Start Capture') }}
            </Button>
            <Button
              v-else
              variant="danger"
              :class="['flex', 'items-center', 'gap-2']"
              @click="handleStopCapture"
            >
              <div i-solar:stop-bold />
              {{ t('settings.pages.modules.vision.test.stop-capture', 'Stop Capture') }}
            </Button>

            <Button
              v-if="isCapturing && analysisMode === 'on-demand'"
              :disabled="isAnalyzing"
              :class="['flex', 'items-center', 'gap-2']"
              @click="handleCaptureAndAnalyze"
            >
              <div v-if="isAnalyzing" i-solar:spinner-line-duotone class="animate-spin" />
              <div v-else i-solar:eye-bold />
              {{ isAnalyzing ? t('settings.pages.modules.vision.test.analyzing', 'Analyzing...') : t('settings.pages.modules.vision.test.analyze-now', 'Analyze Now') }}
            </Button>

            <Button
              v-if="!isCapturing"
              variant="secondary"
              :disabled="isAnalyzing"
              :class="['flex', 'items-center', 'gap-2']"
              @click="handleTestVision"
            >
              <div v-if="isAnalyzing" i-solar:spinner-line-duotone class="animate-spin" />
              <div v-else i-solar:test-tube-bold />
              {{ t('settings.pages.modules.vision.test.quick-test', 'Quick Test') }}
            </Button>
          </div>

          <!-- Status indicators -->
          <div flex="~ row gap-4 items-center" class="text-sm">
            <div flex="~ row gap-2 items-center">
              <div
                :class="[
                  'w-3',
                  'h-3',
                  'rounded-full',
                  isCapturing ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600',
                ]"
              />
              <span>{{ isCapturing ? t('settings.pages.modules.vision.status.capturing', 'Capturing') : t('settings.pages.modules.vision.status.not-capturing', 'Not Capturing') }}</span>
            </div>
            <div v-if="analysisMode === 'continuous' && isCapturing" flex="~ row gap-2 items-center">
              <div
                :class="[
                  'w-3',
                  'h-3',
                  'rounded-full',
                  isAnalyzing ? 'bg-blue-500 animate-pulse' : 'bg-blue-300',
                ]"
              />
              <span>{{ t('settings.pages.modules.vision.status.continuous', 'Continuous Mode') }}</span>
            </div>
          </div>

          <!-- Error display -->
          <Alert v-if="analysisError" type="error">
            <template #title>
              {{ t('settings.pages.modules.vision.test.error', 'Error') }}
            </template>
            <template #content>
              {{ analysisError }}
            </template>
          </Alert>

          <!-- Preview -->
          <div
            v-if="previewImageDataUrl"
            :class="['rounded-lg', 'overflow-hidden', 'border', 'border-neutral-200', 'dark:border-neutral-700']"
          >
            <img
              :src="previewImageDataUrl"
              alt="Captured preview"
              class="w-full h-auto max-h-64 object-contain bg-neutral-100 dark:bg-neutral-800"
            >
          </div>

          <!-- Analysis Result -->
          <div
            v-if="lastAnalysisResult"
            :class="['p-4', 'rounded-lg', 'bg-neutral-100', 'dark:bg-neutral-800']"
          >
            <div :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400', 'mb-2']">
              {{ t('settings.pages.modules.vision.test.result', 'Analysis Result') }}
              <span class="text-xs">
                ({{ new Date(lastAnalysisResult.timestamp).toLocaleTimeString() }})
              </span>
            </div>
            <p class="text-neutral-700 dark:text-neutral-200">
              {{ lastAnalysisResult.description }}
            </p>
          </div>

          <!-- Placeholder when no preview -->
          <div
            v-else-if="!previewImageDataUrl && !lastAnalysisResult"
            :class="['p-8', 'rounded-lg', 'border-2', 'border-dashed', 'border-neutral-200', 'dark:border-neutral-700', 'text-center']"
          >
            <div i-solar:eye-closed-line-duotone class="text-4xl text-neutral-300 dark:text-neutral-600 mx-auto mb-2" />
            <p class="text-neutral-400 dark:text-neutral-500">
              {{ t('settings.pages.modules.vision.test.placeholder', 'Start capture and analyze to see results') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
