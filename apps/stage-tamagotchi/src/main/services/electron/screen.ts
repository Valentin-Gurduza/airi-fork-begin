import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { desktopCapturer, ipcMain, screen } from 'electron'

import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '../../../shared/electron/screen'
import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { useLoop } from '../../libs/event-loop'

export function createScreenService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  const { start, stop } = useLoop(() => {
    const dipPos = screen.getCursorScreenPoint()
    params.context.emit(cursorScreenPoint, dipPos)
  }, {
    autoStart: false,
  })

  onAppWindowAllClosed(() => stop())
  onAppBeforeQuit(() => stop())
  defineInvokeHandler(params.context, startLoopGetCursorScreenPoint, () => start())

  defineInvokeHandler(params.context, electron.screen.getAllDisplays, () => screen.getAllDisplays())
  defineInvokeHandler(params.context, electron.screen.getPrimaryDisplay, () => screen.getPrimaryDisplay())
  defineInvokeHandler(params.context, electron.screen.dipToScreenPoint, point => screen.dipToScreenPoint(point))
  defineInvokeHandler(params.context, electron.screen.dipToScreenRect, rect => screen.dipToScreenRect(params.window, rect))
  defineInvokeHandler(params.context, electron.screen.screenToDipPoint, point => screen.screenToDipPoint(point))
  defineInvokeHandler(params.context, electron.screen.screenToDipRect, rect => screen.screenToDipRect(params.window, rect))
  defineInvokeHandler(params.context, electron.screen.getCursorScreenPoint, () => screen.getCursorScreenPoint())

  // Desktop capturer for vision screen/window capture
  // NOTICE: Using ipcMain.handle directly because the vision store calls this via ipcRenderer.invoke
  // This bypasses eventa's message system to provide direct request/response semantics
  ipcMain.handle('electron.screen.getDesktopSources', async (_event, options: Electron.SourcesOptions) => {
    const sources = await desktopCapturer.getSources(options)
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
    }))
  })

  // Also keep the eventa handler for potential future use by eventa-based consumers
  defineInvokeHandler(params.context, electron.screen.getDesktopSources, async (options) => {
    const sources = await desktopCapturer.getSources(options)
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
    }))
  })
}
