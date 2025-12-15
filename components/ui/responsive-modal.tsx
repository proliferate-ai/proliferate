"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = React.useState(false)

  React.useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)
    media.addEventListener("change", listener)
    return () => media.removeEventListener("change", listener)
  }, [query])

  return matches
}

interface ResponsiveModalProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface ResponsiveModalContentProps {
  children: React.ReactNode
  className?: string
}

interface ResponsiveModalHeaderProps {
  children: React.ReactNode
  className?: string
}

interface ResponsiveModalFooterProps {
  children: React.ReactNode
  className?: string
}

interface ResponsiveModalTitleProps {
  children: React.ReactNode
  className?: string
}

interface ResponsiveModalDescriptionProps {
  children: React.ReactNode
  className?: string
}

const ResponsiveModalContext = React.createContext<{ isDesktop: boolean }>({ isDesktop: true })

function ResponsiveModal({ children, open, onOpenChange }: ResponsiveModalProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)")

  if (isDesktop) {
    return (
      <ResponsiveModalContext.Provider value={{ isDesktop: true }}>
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
          {children}
        </DialogPrimitive.Root>
      </ResponsiveModalContext.Provider>
    )
  }

  return (
    <ResponsiveModalContext.Provider value={{ isDesktop: false }}>
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange}>
        {children}
      </DrawerPrimitive.Root>
    </ResponsiveModalContext.Provider>
  )
}

function ResponsiveModalTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isDesktop } = React.useContext(ResponsiveModalContext)

  if (isDesktop) {
    return <DialogPrimitive.Trigger className={className}>{children}</DialogPrimitive.Trigger>
  }

  return <DrawerPrimitive.Trigger className={className}>{children}</DrawerPrimitive.Trigger>
}

function ResponsiveModalClose({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { isDesktop } = React.useContext(ResponsiveModalContext)

  if (isDesktop) {
    return <DialogPrimitive.Close className={className}>{children}</DialogPrimitive.Close>
  }

  return <DrawerPrimitive.Close className={className}>{children}</DrawerPrimitive.Close>
}

function ResponsiveModalContent({ children, className }: ResponsiveModalContentProps) {
  const { isDesktop } = React.useContext(ResponsiveModalContext)

  if (isDesktop) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-neutral-800 bg-neutral-950 p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-xl focus:outline-none",
            className
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none">
            <X className="h-4 w-4 text-neutral-400" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )
  }

  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <DrawerPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto max-h-[96vh] flex-col rounded-t-2xl border-t border-neutral-800 bg-neutral-950 focus:outline-none",
          className
        )}
      >
        <div className="mx-auto mt-3 h-1 w-10 flex-shrink-0 rounded-full bg-neutral-700" />
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  )
}

function ResponsiveModalHeader({ children, className }: ResponsiveModalHeaderProps) {
  return (
    <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}>
      {children}
    </div>
  )
}

function ResponsiveModalFooter({ children, className }: ResponsiveModalFooterProps) {
  const { isDesktop } = React.useContext(ResponsiveModalContext)

  return (
    <div className={cn(
      isDesktop
        ? "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2"
        : "flex flex-col gap-2 pt-4",
      className
    )}>
      {children}
    </div>
  )
}

function ResponsiveModalTitle({ children, className }: ResponsiveModalTitleProps) {
  const { isDesktop } = React.useContext(ResponsiveModalContext)

  if (isDesktop) {
    return (
      <DialogPrimitive.Title className={cn("text-lg font-semibold leading-none tracking-tight text-neutral-100", className)}>
        {children}
      </DialogPrimitive.Title>
    )
  }

  return (
    <DrawerPrimitive.Title className={cn("text-lg font-semibold leading-none tracking-tight text-neutral-100", className)}>
      {children}
    </DrawerPrimitive.Title>
  )
}

function ResponsiveModalDescription({ children, className }: ResponsiveModalDescriptionProps) {
  const { isDesktop } = React.useContext(ResponsiveModalContext)

  if (isDesktop) {
    return (
      <DialogPrimitive.Description className={cn("text-sm text-neutral-400", className)}>
        {children}
      </DialogPrimitive.Description>
    )
  }

  return (
    <DrawerPrimitive.Description className={cn("text-sm text-neutral-400", className)}>
      {children}
    </DrawerPrimitive.Description>
  )
}

export {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalClose,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalFooter,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
}
