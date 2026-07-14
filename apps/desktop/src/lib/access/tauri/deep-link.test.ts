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
  })
})
