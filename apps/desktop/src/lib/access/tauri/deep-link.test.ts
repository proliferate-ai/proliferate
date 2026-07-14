import { beforeEach, describe, expect, it, vi } from "vitest"

const deepLinkMocks = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  onOpenUrl: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-deep-link", () => deepLinkMocks)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// The module holds live subscriber/listener state at module scope, so each
// test loads a fresh copy.
async function loadDeepLink() {
  vi.resetModules()
  return import("./deep-link")
}

describe("deep-link raw source", () => {
  beforeEach(() => {
    deepLinkMocks.getCurrent.mockReset()
    deepLinkMocks.onOpenUrl.mockReset()
  })

  it("delivers the initial getCurrent snapshot and subsequent live urls to an active listener", async () => {
    deepLinkMocks.getCurrent.mockResolvedValue(["proliferate://initial"])
    let openUrlCallback: ((urls: string[]) => void) | undefined
    deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      openUrlCallback = cb
      return () => {}
    })

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const received: string[] = []
    subscribeDeepLinkUrls((url) => received.push(url))

    await vi.waitFor(() => expect(received).toContain("proliferate://initial"))
    await vi.waitFor(() => expect(openUrlCallback).toBeDefined())

    openUrlCallback?.(["proliferate://live"])

    expect(received).toEqual(["proliferate://initial", "proliferate://live"])
  })

  it("orders a startup live url after the unresolved initial snapshot and suppresses after unsubscribe", async () => {
    const current = deferred<string[]>()
    deepLinkMocks.getCurrent.mockReturnValue(current.promise)
    let openUrlCallback: ((urls: string[]) => void) | undefined
    deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      openUrlCallback = cb
      return () => {}
    })

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const received: string[] = []
    const unsubscribe = subscribeDeepLinkUrls((url) => received.push(url))

    await vi.waitFor(() => expect(openUrlCallback).toBeDefined())
    await vi.waitFor(() => expect(deepLinkMocks.getCurrent).toHaveBeenCalledTimes(1))
    openUrlCallback?.(["proliferate://live-during-startup"])
    expect(received).toEqual([])

    current.resolve(["proliferate://initial"])
    await vi.waitFor(() => {
      expect(received).toEqual([
        "proliferate://initial",
        "proliferate://live-during-startup",
      ])
    })

    openUrlCallback?.(["proliferate://live-after-startup"])
    expect(received).toEqual([
      "proliferate://initial",
      "proliferate://live-during-startup",
      "proliferate://live-after-startup",
    ])

    unsubscribe()
    openUrlCallback?.(["proliferate://after-unsubscribe"])
    expect(received).toEqual([
      "proliferate://initial",
      "proliferate://live-during-startup",
      "proliferate://live-after-startup",
    ])
  })

  it("shares a single native live listener across multiple subscribers", async () => {
    deepLinkMocks.getCurrent.mockResolvedValue(null)
    let openUrlCallback: ((urls: string[]) => void) | undefined
    deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      openUrlCallback = cb
      return () => {}
    })

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const receivedA: string[] = []
    const receivedB: string[] = []
    subscribeDeepLinkUrls((url) => receivedA.push(url))
    subscribeDeepLinkUrls((url) => receivedB.push(url))

    await vi.waitFor(() => expect(openUrlCallback).toBeDefined())
    expect(deepLinkMocks.onOpenUrl).toHaveBeenCalledTimes(1)

    openUrlCallback?.(["proliferate://live"])

    expect(receivedA).toEqual(["proliferate://live"])
    expect(receivedB).toEqual(["proliferate://live"])
  })

  it("is race-safe when unsubscribed before native registration and the initial snapshot settle", async () => {
    const current = deferred<string[]>()
    deepLinkMocks.getCurrent.mockReturnValue(current.promise)
    const registration = deferred<() => void>()
    let openUrlCallback: ((urls: string[]) => void) | undefined
    deepLinkMocks.onOpenUrl.mockImplementation((cb: (urls: string[]) => void) => {
      openUrlCallback = cb
      return registration.promise
    })

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const received: string[] = []
    const unsubscribe = subscribeDeepLinkUrls((url) => received.push(url))
    unsubscribe()

    current.resolve(["proliferate://initial"])
    registration.resolve(() => {})
    await vi.waitFor(() => expect(openUrlCallback).toBeDefined())

    openUrlCallback?.(["proliferate://live"])

    // Flush the still-settling initial-snapshot drain.
    await Promise.resolve()
    await Promise.resolve()

    expect(received).toEqual([])
  })

  it("unsubscribing one listener does not affect another sharing the native listener", async () => {
    deepLinkMocks.getCurrent.mockResolvedValue(null)
    let openUrlCallback: ((urls: string[]) => void) | undefined
    deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      openUrlCallback = cb
      return () => {}
    })

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const receivedA: string[] = []
    const receivedB: string[] = []
    const unsubscribeA = subscribeDeepLinkUrls((url) => receivedA.push(url))
    subscribeDeepLinkUrls((url) => receivedB.push(url))

    await vi.waitFor(() => expect(openUrlCallback).toBeDefined())
    unsubscribeA()

    openUrlCallback?.(["proliferate://live"])

    expect(receivedA).toEqual([])
    expect(receivedB).toEqual(["proliferate://live"])
  })

  it("does not replay an already-delivered live url to a later subscriber", async () => {
    deepLinkMocks.getCurrent.mockResolvedValue(null)
    let openUrlCallback: ((urls: string[]) => void) | undefined
    deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      openUrlCallback = cb
      return () => {}
    })

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const receivedA: string[] = []
    subscribeDeepLinkUrls((url) => receivedA.push(url))
    await vi.waitFor(() => expect(openUrlCallback).toBeDefined())

    openUrlCallback?.(["proliferate://live-before"])
    expect(receivedA).toEqual(["proliferate://live-before"])

    // A subscriber joining later only gets its own getCurrent snapshot, not
    // urls already delivered to earlier subscribers.
    deepLinkMocks.getCurrent.mockResolvedValue(["proliferate://later-snapshot"])
    const receivedB: string[] = []
    subscribeDeepLinkUrls((url) => receivedB.push(url))
    await vi.waitFor(() => expect(receivedB).toContain("proliferate://later-snapshot"))
    expect(receivedB).toEqual(["proliferate://later-snapshot"])

    openUrlCallback?.(["proliferate://live-after"])
    expect(receivedA).toEqual(["proliferate://live-before", "proliferate://live-after"])
    expect(receivedB).toEqual(["proliferate://later-snapshot", "proliferate://live-after"])
  })

  it("swallows getCurrent/onOpenUrl failures outside Tauri for subscribeDeepLinkUrls", async () => {
    deepLinkMocks.getCurrent.mockRejectedValue(new Error("no tauri"))
    deepLinkMocks.onOpenUrl.mockRejectedValue(new Error("no tauri"))

    const { subscribeDeepLinkUrls } = await loadDeepLink()
    const received: string[] = []
    expect(() => subscribeDeepLinkUrls((url) => received.push(url))).not.toThrow()

    await vi.waitFor(() => expect(deepLinkMocks.getCurrent).toHaveBeenCalled())
    expect(received).toEqual([])
  })

  describe("ensureDeepLinkBridge", () => {
    it("registers auth beside product routing before a startup live callback is delivered", async () => {
      const current = deferred<string[] | null>()
      deepLinkMocks.getCurrent.mockReturnValue(current.promise)
      let openUrlCallback: ((urls: string[]) => void) | undefined
      deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
        openUrlCallback = cb
        return () => {}
      })

      const { ensureDeepLinkBridge, subscribeDeepLinkUrls } = await loadDeepLink()
      const productUrls: string[] = []
      const authHandler = vi.fn().mockResolvedValue(true)

      // Product routing mounts first. Auth bootstrap still joins synchronously
      // in the same turn, before the one native-listener registration settles.
      subscribeDeepLinkUrls((url) => productUrls.push(url))
      const bridge = ensureDeepLinkBridge(authHandler)

      await vi.waitFor(() => expect(openUrlCallback).toBeDefined())
      await vi.waitFor(() => expect(deepLinkMocks.getCurrent).toHaveBeenCalledTimes(2))
      const authUrl = "proliferate://auth/callback?code=code-1&state=state-1"
      openUrlCallback?.([authUrl])

      // Both consumers keep initial-before-live ordering while their snapshot
      // reads are unresolved.
      expect(productUrls).toEqual([])
      expect(authHandler).not.toHaveBeenCalled()

      current.resolve(null)
      await bridge
      await vi.waitFor(() => expect(productUrls).toEqual([authUrl]))
      expect(authHandler).toHaveBeenCalledTimes(1)
      expect(authHandler).toHaveBeenCalledWith(authUrl)
    })

    it("drains the current snapshot then forwards live urls to the handler", async () => {
      deepLinkMocks.getCurrent.mockResolvedValue(["proliferate://initial"])
      let openUrlCallback: ((urls: string[]) => void) | undefined
      deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
        openUrlCallback = cb
        return () => {}
      })

      const { ensureDeepLinkBridge } = await loadDeepLink()
      const handler = vi.fn().mockResolvedValue(true)
      await ensureDeepLinkBridge(handler)

      expect(handler).toHaveBeenCalledWith("proliferate://initial")

      openUrlCallback?.(["proliferate://live"])

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenLastCalledWith("proliferate://live")
    })

    it("swallows getCurrent/onOpenUrl failures outside Tauri and still resolves", async () => {
      deepLinkMocks.getCurrent.mockRejectedValue(new Error("no tauri"))
      deepLinkMocks.onOpenUrl.mockRejectedValue(new Error("no tauri"))

      const { ensureDeepLinkBridge } = await loadDeepLink()
      await expect(ensureDeepLinkBridge(vi.fn())).resolves.toBeUndefined()
    })

    it("contains handler rejections for both initial and live urls", async () => {
      deepLinkMocks.getCurrent.mockResolvedValue(["proliferate://initial"])
      let openUrlCallback: ((urls: string[]) => void) | undefined
      deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
        openUrlCallback = cb
        return () => {}
      })

      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason)
      }
      process.on("unhandledRejection", onUnhandled)
      try {
        const { ensureDeepLinkBridge } = await loadDeepLink()
        const handler = vi.fn().mockRejectedValue(new Error("callback failed"))
        await expect(ensureDeepLinkBridge(handler)).resolves.toBeUndefined()
        expect(handler).toHaveBeenCalledWith("proliferate://initial")

        openUrlCallback?.(["proliferate://live"])
        expect(handler).toHaveBeenLastCalledWith("proliferate://live")

        // Give any escaped rejection two macrotask turns to reach the hook.
        await new Promise((resolve) => setTimeout(resolve, 0))
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", onUnhandled)
      }
    })

    it("memoizes the first call — a second call registers nothing and shares one live listener", async () => {
      deepLinkMocks.getCurrent.mockResolvedValue(["proliferate://initial"])
      let openUrlCallback: ((urls: string[]) => void) | undefined
      deepLinkMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
        openUrlCallback = cb
        return () => {}
      })

      const { ensureDeepLinkBridge } = await loadDeepLink()
      const handlerA = vi.fn().mockResolvedValue(true)
      const handlerB = vi.fn().mockResolvedValue(true)

      const first = ensureDeepLinkBridge(handlerA)
      const second = ensureDeepLinkBridge(handlerB)

      expect(second).toBe(first)
      await first
      await second

      // getCurrent (the drain) only ran once, for the first registration.
      expect(deepLinkMocks.getCurrent).toHaveBeenCalledTimes(1)
      expect(handlerA).toHaveBeenCalledTimes(1)
      expect(handlerA).toHaveBeenCalledWith("proliferate://initial")
      expect(handlerB).not.toHaveBeenCalled()

      openUrlCallback?.(["proliferate://live"])

      // Only the first handler ever registered — one invocation total for
      // the live url, not two.
      expect(handlerA).toHaveBeenCalledTimes(2)
      expect(handlerA).toHaveBeenLastCalledWith("proliferate://live")
      expect(handlerB).not.toHaveBeenCalled()
    })
  })
})
