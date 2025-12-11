"use client"

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner"
import { useRef } from "react"

export function useSearchParamToast() {
  interface Message {
    type: "error" | "success" | "info" | "warning"
    message: string
  }

  const searchParams = useSearchParams();
  
  const router = useRouter();
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  useEffect(() => {
    const searchParamToMessage: Record<string, Message> = {
      "signup": {
        type: "success",
        message: "Sign up to get started"
      },
      "login": {
        type: "success",
        message: "Login to get started"
      },
      "forgot-password": {
        type: "error",
        message: "Forgot your password?"
      },
      "invalid_domain": {
        type: "error",
        message: "Invalid domain- schedule a demo for access"
      }
    };
    // Clear any existing timeouts
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
    }

    // Find the first matching search param
    const matchingKeys = Object.keys(searchParamToMessage)
      .filter(k => searchParams.has(k));

    if (matchingKeys.length === 0) return;
    
    // Process the first matching key
    const key = matchingKeys[0];
    const message = searchParamToMessage[key as keyof typeof searchParamToMessage];

    // Common toast options for all types
    const toastOptions = {
      position: "top-center" as const,
      duration: message.type === "error" ? 10000 : 5000,
    };

    // Schedule new toast
    toastTimeoutRef.current = setTimeout(() => {
      // Show toast based on message type
      switch (message.type) {
        case "success":
          toast.success(message.message, {
            ...toastOptions,
            style: {
              backgroundColor: "#111111",
              color: "#ffffff",
              borderLeft: "4px solid #10b981" // Green border
            },
          });
          break;
        case "error":
          toast.error(message.message, {
            ...toastOptions,
            style: {
              backgroundColor: "#111111",
              color: "#ffffff",
              borderLeft: "4px solid #ff4d4f" // Red border
            },
          });
          break;
        case "info":
          toast.info(message.message, {
            ...toastOptions,
            style: {
              backgroundColor: "#111111",
              color: "#ffffff",
              borderLeft: "4px solid #3b82f6" // Blue border
            },
          });
          break;
        case "warning":
          toast.warning(message.message, {
            ...toastOptions,
            style: {
              backgroundColor: "#111111",
              color: "#ffffff",
              borderLeft: "4px solid #f59e0b" // Amber/yellow border
            },
          });
          break;
      }

      // Schedule cleanup
      cleanupTimeoutRef.current = setTimeout(() => {
        // Remove all search params to ensure toast only shows once
        router.replace(window.location.pathname);
      }, 200);
    }, 100);

    // Cleanup function to clear timeouts if component unmounts
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }
    };
  }, [searchParams, router]);
}

// Wrapper component to be used with Suspense
export function SearchParamToastWrapper() {
  useSearchParamToast();
  return null;
}