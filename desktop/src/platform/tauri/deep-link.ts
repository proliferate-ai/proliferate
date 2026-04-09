import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"

export type DeepLinkUrlHandler = (url: string) => Promise<boolean>

let deepLinkBridgePromise: Promise<void> | null = null

/**
 * Ensures the Tauri deep-link listener is registered exactly once.
 * Drains any URLs that arrived before the listener was set up, then
 * forwards every subsequent deep-link URL to `handler`.
 *
 * Safe to call outside Tauri — errors are silently swallowed.
 */
export function ensureDeepLinkBridge(handler: DeepLinkUrlHandler): Promise<void> {
  if (deepLinkBridgePromise) {
    return deepLinkBridgePromise
  }

  deepLinkBridgePromise = (async () => {
    try {
      const currentUrls = await getCurrent()
      if (currentUrls?.length) {
        for (const url of currentUrls) {
          await handler(url)
        }
      }

      await onOpenUrl((urls) => {
        for (const url of urls) {
          void handler(url)
        }
      })
    } catch {
      // Ignore when running outside Tauri or before the plugin is available.
    }
  })()

  return deepLinkBridgePromise
}
