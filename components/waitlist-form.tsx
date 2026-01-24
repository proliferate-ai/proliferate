"use client"

import { useState } from "react"
import Image from "next/image"
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const FALLBACK_EMAIL = "pablo@proliferate.ai"

interface WaitlistFormProps {
  children: React.ReactNode
}

export function WaitlistForm({ children }: WaitlistFormProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState("")
  const [isCriticalError, setIsCriticalError] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError("")
    setIsCriticalError(false)

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, email }),
      })

      const data = await response.json()

      if (!response.ok || !data.ok) {
        if (data.critical) {
          setIsCriticalError(true)
        }
        throw new Error(data.error || "Something went wrong. Please try again.")
      }

      setIsSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={setOpen}>
      <ResponsiveModalTrigger asChild>
        {children}
      </ResponsiveModalTrigger>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2 text-xl">
            <Image
              src={`https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp?timestamp=${Date.now()}`}
              alt="Proliferate Logo"
              width={32}
              height={32}
              className="h-6 w-6"
            />
            Join Early Access
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Join the waitlist to get early access. Limited availability.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {!isSuccess ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-sm font-medium text-neutral-300">
                Company Name
              </label>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your company name"
                className="bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-medium text-neutral-300">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                className="bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500"
                required
              />
            </div>

            {error && (
              isCriticalError ? (
                <div className="rounded-lg bg-red-950 border-2 border-red-500 p-4 text-center">
                  <p className="text-red-400 font-semibold mb-2">Something went wrong!</p>
                  <p className="text-red-300 text-sm mb-3">{error}</p>
                  <a
                    href={`mailto:${FALLBACK_EMAIL}?subject=Early Access Request - ${encodeURIComponent(name)}&body=Hi, I tried to sign up for early access but encountered an error.%0A%0ACompany: ${encodeURIComponent(name)}%0AEmail: ${encodeURIComponent(email)}`}
                    className="inline-block bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-md text-sm"
                  >
                    Email Us Directly
                  </a>
                </div>
              ) : (
                <p className="text-sm text-red-500">{error}</p>
              )
            )}

            <Button
              type="submit"
              className="bg-neutral-100 text-neutral-900 hover:bg-white mt-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Request Early Access"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="rounded-full bg-green-900/20 p-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-neutral-100">You&apos;re on the list!</h3>
            <p className="text-center text-neutral-400">
              We&apos;ll let you know when you can onboard.
            </p>
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
