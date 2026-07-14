import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"

export type DeepLinkUrlHandler = (url: string) => Promise<boolean>

type DeepLinkListener = (url: string) => void

interface DeepLinkSubscription {
  listener: DeepLinkListener
  active: boolean
}

// Every active subscription, in subscribe order. Delivery always reads this
// set fresh, so removing a subscription (or flipping `active` off) takes
// effect immediately for both the in-flight initial snapshot and any live
// URL still queued on the microtask/event loop.
const subscriptions = new Set<DeepLinkSubscription>()

// At most one native live listener is ever registered; this memoizes the
// in-flight/settled registration so concurrent subscribers share it.
let liveListenerPromise: Promise<void> | null = null

function ensureLiveListener(): Promise<void> {
  if (!liveListenerPromise) {
    liveListenerPromise = Promise.resolve()
      .then(() =>
        onOpenUrl((urls) => {
          for (const url of urls) {
            for (const subscription of subscriptions) {
              if (subscription.active) {
                subscription.listener(url)
              }
            }
          }
        }),
      )
      .then(() => undefined)
  }
  return liveListenerPromise
}

function deliverInitialSnapshot(subscription: DeepLinkSubscription): Promise<void> {
  return (async () => {
    try {
      const currentUrls = await getCurrent()
      if (subscription.active && currentUrls?.length) {
        for (const url of currentUrls) {
          subscription.listener(url)
        }
      }
    } catch {
      // Ignore when running outside Tauri or before the plugin is available.
    }
  })()
}

/**
 * Subscribes to the raw Tauri deep-link source. Delivers Tauri's current
 * `getCurrent()` snapshot (if any) to this subscriber only, then forwards
 * every URL that arrives while the subscription is active. At most one
 * native live listener is ever registered — it is created lazily on the
 * first subscription and shared by every subscriber.
 *
 * There is no history or queue: a URL delivered before a later subscriber
 * mounts is never replayed to it, and no raw URL is retained after delivery.
 *
 * Returns a synchronous unsubscribe function. Unsubscribing is race-safe
 * even while native registration (or this subscriber's initial snapshot
 * drain) is still in flight — no further delivery reaches this listener
 * after unsubscribe, and other subscribers are unaffected.
 *
 * Safe to call outside Tauri — errors are silently swallowed.
 */
export function subscribeDeepLinkUrls(listener: DeepLinkListener): () => void {
  const subscription: DeepLinkSubscription = { listener, active: true }
  subscriptions.add(subscription)

  void deliverInitialSnapshot(subscription)
  void ensureLiveListener().catch(() => {
    // Ignore when running outside Tauri or before the plugin is available.
  })

  return () => {
    subscription.active = false
    subscriptions.delete(subscription)
  }
}

/**
 * Legacy adapter over the multiplexed raw source above. Drains any URLs
 * that arrived before subscription, then forwards every subsequent
 * deep-link URL to `handler`. Unlike `subscribeDeepLinkUrls`, this handler
 * is never unsubscribed — it lives for the process, matching the existing
 * bootstrap-time callback consumer.
 *
 * Safe to call outside Tauri — errors are silently swallowed. The returned
 * promise resolves once the initial drain and the live-listener
 * registration attempt have both settled.
 */
export function ensureDeepLinkBridge(handler: DeepLinkUrlHandler): Promise<void> {
  const subscription: DeepLinkSubscription = {
    listener: (url) => {
      void handler(url)
    },
    active: true,
  }
  subscriptions.add(subscription)

  return Promise.all([
    deliverInitialSnapshot(subscription),
    ensureLiveListener().catch(() => {
      // Ignore when running outside Tauri or before the plugin is available.
    }),
  ]).then(() => undefined)
}
