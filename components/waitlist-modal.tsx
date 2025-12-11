"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
      
      // Reset after showing success
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md border-neutral-300 focus:border-neutral-300">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Join the waitlist</DialogTitle>
        </DialogHeader>
        
        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-700 mb-2">
                Work email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                required
              />
            </div>
            
            <p className="text-sm text-neutral-600">
              We promise we won&apos;t spam you. We&apos;ll only reach out when Keystone is ready for your team.
            </p>
            
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-keystone-dark text-white py-3 px-6 rounded-lg font-medium hover:bg-keystone-dark/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Joining..." : "Join waitlist"}
            </button>
          </form>
        ) : (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-neutral-900">You&apos;re on the list!</h3>
            <p className="text-neutral-600 mt-2">We&apos;ll be in touch soon.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
    ? "border border-keystone-dark text-keystone-dark hover:bg-keystone-dark hover:text-white" 
    : "bg-keystone-dark text-white hover:bg-keystone-dark/90";
  
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