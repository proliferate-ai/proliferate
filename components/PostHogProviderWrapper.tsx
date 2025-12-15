"use client"

import dynamic from "next/dynamic"

const PostHogProvider = dynamic(
  () => import("./PostHogProvider").then((mod) => mod.PostHogProvider),
  { ssr: false }
)

export function PostHogProviderWrapper({ children }: { children: React.ReactNode }) {
  return <PostHogProvider>{children}</PostHogProvider>
}
