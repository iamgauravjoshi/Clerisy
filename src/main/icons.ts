import { app, type NativeImage, nativeImage } from 'electron'
import { join } from 'node:path'

// The icons generated from resources/logo.svg (`npm run icons`). The installed app ships them outside the asar
// archive (electron-builder `extraResources`), at a fixed path, so Electron can pick the @1.25x/@1.5x/@2x tray
// variant that matches the display scale.
const iconDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources', 'icons'))

/** The 256 px app icon, for windows and notifications. */
export const appIconPath = (): string => join(iconDir(), 'app.png')

const trayImages = new Map<boolean, NativeImage>()

/** The tray icon: the logo, with a red dot while recording. */
export function trayImage(recording: boolean): NativeImage {
  let img = trayImages.get(recording)
  if (!img) {
    img = nativeImage.createFromPath(join(iconDir(), recording ? 'tray-recording.png' : 'tray.png'))
    trayImages.set(recording, img)
  }
  return img
}
