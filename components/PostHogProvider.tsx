"use client"

import { Suspense, useEffect, useState, createContext, useContext } from "react"
import { usePathname, useSearchParams } from "next/navigation"

interface PostHogInstance {
  init: (key: string, options: object) => void
  capture: (event: string, properties: object) => void
}

const PostHogContext = createContext<PostHogInstance | null>(null)

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [posthog, setPosthog] = useState<PostHogInstance | null>(null)

  useEffect(() => {
    const loadPostHog = async () => {
      const posthogModule = await import("posthog-js")

      posthogModule.default.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        capture_pageview: false,
        capture_pageleave: true,
        debug: process.env.NODE_ENV === "development",
      })

      setPosthog(posthogModule.default)
    }
    loadPostHog()
  }, [])

  return (
    <PostHogContext.Provider value={posthog}>
      <SuspendedPostHogPageView />
      {children}
    </PostHogContext.Provider>
  )
}

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = useContext(PostHogContext)

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname
      const search = searchParams.toString()
      if (search) {
        url += "?" + search
      }
      posthog.capture("$pageview", { "$current_url": url })
    }
  }, [pathname, searchParams, posthog])

  return null
}

function SuspendedPostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageView />
    </Suspense>
  )
}
