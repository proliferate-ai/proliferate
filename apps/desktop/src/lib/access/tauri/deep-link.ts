import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"

export type DeepLinkUrlHandler = (url: string) => Promise<boolean>

type DeepLinkListener = (url: string) => void

interface DeepLinkSubscription {
  listener: DeepLinkListener
  active: boolean
  awaitingInitialSnapshot: boolean
  pendingLiveUrls: string[]
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
              deliverLiveUrl(subscription, url)
            }
          }
        }),
      )
      .then(() => undefined)
  }
  return liveListenerPromise
}

function deliverLiveUrl(subscription: DeepLinkSubscription, url: string): void {
  if (!subscription.active) return

  if (subscription.awaitingInitialSnapshot) {
    // This per-subscription barrier exists only while getCurrent() settles. It
    // prevents a live URL from overtaking the initial snapshot without making
    // live URLs replayable to subscribers that mount later.
    subscription.pendingLiveUrls.push(url)
    return
  }

  subscription.listener(url)
}

function deliverInitialSnapshot(subscription: DeepLinkSubscription): Promise<void> {
  return (async () => {
    try {
      const currentUrls = await getCurrent()
      if (subscription.active && currentUrls?.length) {
        for (const url of currentUrls) {
          if (!subscription.active) break
          subscription.listener(url)
        }
      }
    } catch {
      // Ignore when running outside Tauri or before the plugin is available.
    } finally {
      // Keep the barrier raised while draining. A live event synchronously
      // triggered by a listener is appended and delivered after every URL
      // already waiting, so initial-before-live ordering remains strict.
      while (subscription.active && subscription.pendingLiveUrls.length > 0) {
        const url = subscription.pendingLiveUrls.shift()
        if (url !== undefined) subscription.listener(url)
      }
      subscription.awaitingInitialSnapshot = false
      subscription.pendingLiveUrls.length = 0
    }
  })()
}

function initializeSubscription(subscription: DeepLinkSubscription): Promise<void> {
  return (async () => {
    // Register live delivery before reading the snapshot. Any event delivered
    // during registration or getCurrent() waits behind this subscription's
    // short-lived ordering barrier, closing the startup gap between the two
    // native APIs.
    await ensureLiveListener().catch(() => {
      // Ignore when running outside Tauri or before the plugin is available.
    })

    if (!subscription.active) return
    await deliverInitialSnapshot(subscription)
  })()
}

/**
 * Subscribes to the raw Tauri deep-link source. Delivers Tauri's current
 * `getCurrent()` snapshot (if any) to this subscriber only, then forwards
 * every URL that arrives while the subscription is active. At most one
 * native live listener is ever registered — it is created lazily on the
 * first subscription and shared by every subscriber.
 *
 * Each subscription has a short-lived ordering barrier only while its initial
 * snapshot settles. Buffered live URLs are drained immediately afterward (or
 * discarded on unsubscribe). There is no shared/durable history: a URL
 * delivered before a later subscriber mounts is never replayed to it.
 *
 * Returns a synchronous unsubscribe function. Unsubscribing is race-safe
 * even while native registration (or this subscriber's initial snapshot
 * drain) is still in flight — no further delivery reaches this listener
 * after unsubscribe, and other subscribers are unaffected.
 *
 * Safe to call outside Tauri — errors are silently swallowed.
 */
export function subscribeDeepLinkUrls(listener: DeepLinkListener): () => void {
  const subscription: DeepLinkSubscription = {
    listener,
    active: true,
    awaitingInitialSnapshot: true,
    pendingLiveUrls: [],
  }
  subscriptions.add(subscription)

  void initializeSubscription(subscription)

  return () => {
    subscription.active = false
    subscription.pendingLiveUrls.length = 0
    subscriptions.delete(subscription)
  }
}

// Memoizes the first `ensureDeepLinkBridge` call: only the first handler is
// ever registered, matching the pre-multiplex bridge's once-only semantics.
// Later calls return this same promise and register nothing.
let deepLinkBridgePromise: Promise<void> | null = null

/**
 * Legacy adapter over the multiplexed raw source above. Registers its
 * subscription synchronously, then delivers its own initial snapshot before
 * every live URL received during that read. Unlike `subscribeDeepLinkUrls`, this handler
 * is never unsubscribed — it lives for the process, matching the existing
 * bootstrap-time callback consumer.
 *
 * Only the first call registers a handler; subsequent calls (e.g. a
 * duplicate bootstrap invocation under React.StrictMode) are no-ops that
 * resolve once the original registration settles.
 *
 * Safe to call outside Tauri — errors are silently swallowed. The returned
 * promise resolves once the initial drain and the live-listener
 * registration attempt have both settled.
 */
export function ensureDeepLinkBridge(handler: DeepLinkUrlHandler): Promise<void> {
  if (!deepLinkBridgePromise) {
    // Register synchronously. Product routing may already have requested the
    // shared native listener in this React effect turn; joining the subscriber
    // set before that registration microtask settles prevents an auth callback
    // from being delivered only to (and ignored by) product routing.
    let deliveryTail = Promise.resolve();
    let serializingInitialDelivery = true;
    const subscription: DeepLinkSubscription = {
      listener: (url) => {
        if (!serializingInitialDelivery) {
          void handler(url).catch(() => {
            // Callback failures are contained by this legacy adapter.
          });
          return;
        }
        deliveryTail = deliveryTail
          .then(() => handler(url))
          .then(() => undefined)
          .catch(() => {
            // Callback failures are contained by this legacy adapter.
          });
      },
      active: true,
      awaitingInitialSnapshot: true,
      pendingLiveUrls: [],
    };
    subscriptions.add(subscription);

    deepLinkBridgePromise = (async () => {
      await initializeSubscription(subscription);
      await deliveryTail;
      serializingInitialDelivery = false;
    })();
  }
  return deepLinkBridgePromise;
}
