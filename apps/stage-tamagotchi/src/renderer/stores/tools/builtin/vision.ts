import type { Tool } from '@xsai/shared-chat'

import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const visionParams = z.object({
  action: z.enum(['capture', 'describe']).describe('Action to perform: capture (take a screenshot), describe (analyze what is visible)'),
  source: z.enum(['screen', 'camera', 'window']).optional().describe('Source to capture from: screen (default), camera (webcam), or window'),
  query: z.string().optional().describe('Optional question about what to look for or describe in the captured image'),
}).strict()

interface VisionActionInput {
  action: 'capture' | 'describe'
  source?: 'screen' | 'camera' | 'window'
  query?: string
}

export async function executeVisionAction(input: VisionActionInput): Promise<string> {
  const visionStore = useVisionStore()

  // Check if vision is configured
  if (!visionStore.configured) {
    return 'Vision module is not configured. Please set up vision in Settings → Modules → Vision first.'
  }

  switch (input.action) {
    case 'capture':
    case 'describe': {
      // Stop any existing capture first
      if (visionStore.isCapturing) {
        visionStore.stopCapture()
      }

      // Set capture source if specified
      if (input.source) {
        visionStore.captureSource = input.source
      }

      // Start capture
      let success = await visionStore.startCapture()

      // If screen capture fails (common in Electron), try falling back to camera
      if (!success && visionStore.captureSource !== 'camera') {
        console.warn('Screen capture failed, falling back to camera')
        visionStore.captureSource = 'camera'
        success = await visionStore.startCapture()
      }

      if (!success) {
        return `Failed to start capture: ${visionStore.analysisError || 'Unknown error'}. Please check vision settings and ensure you have granted the necessary permissions.`
      }

      // Capture and analyze the current frame
      const result = await visionStore.captureAndAnalyze(input.query)

      // Stop capture after single use to avoid resource drain
      visionStore.stopCapture()

      if (visionStore.analysisError) {
        return `Vision analysis failed: ${visionStore.analysisError}`
      }

      if (!result || !result.description) {
        return 'No analysis result was returned. The screen may be blank or the capture failed.'
      }

      return result.description
    }
    default:
      return 'Unknown vision action.'
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'see_screen',
    description: 'Capture and analyze what is currently visible on the screen, camera, or window. Use this when the user asks you to look at, see, describe, or analyze something visible on their screen or camera.',
    execute: params => executeVisionAction(params as VisionActionInput),
    parameters: visionParams,
  }),
]

export const visionTools = async () => Promise.all(tools)
