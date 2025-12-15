"use client";

import { useState } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WaitlistModal({ isOpen, onClose }: WaitlistModalProps) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error('Failed to join waitlist');
      }

      setIsSubmitted(true);

      setTimeout(() => {
        setIsSubmitted(false);
        setEmail("");
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Error joining waitlist:', error);
      alert('Sorry, there was an error joining the waitlist. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResponsiveModal open={isOpen} onOpenChange={onClose}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Join the waitlist</ResponsiveModalTitle>
        </ResponsiveModalHeader>

        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-400 mb-2">
                Work email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:border-transparent"
                required
              />
            </div>

            <p className="text-sm text-neutral-500">
              We promise we won&apos;t spam you. We&apos;ll only reach out when Proliferate is ready for your team.
            </p>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-white text-neutral-900 py-3 px-6 rounded-lg font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Joining..." : "Join waitlist"}
            </button>
          </form>
        ) : (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-neutral-100">You&apos;re on the list!</h3>
            <p className="text-neutral-400 mt-2">We&apos;ll be in touch soon.</p>
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

export function WaitlistButton({
  className = "",
  variant = "default",
  size = "default"
}: {
  className?: string;
  variant?: "default" | "outline";
  size?: "default" | "lg";
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const baseClasses = "inline-flex items-center justify-center font-medium rounded-md transition-colors";
  const sizeClasses = size === "lg" ? "py-2 px-8 text-lg" : "py-2 px-4";
  const variantClasses = variant === "outline"
    ? "border border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white"
    : "bg-white text-neutral-900 hover:bg-neutral-100";

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      >
        Join waitlist
      </button>
      <WaitlistModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
