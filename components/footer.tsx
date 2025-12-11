"use client";

import Link from "next/link";
import Image from "next/image";
import { smoothScrollToHash } from "@/lib/utils";
import type { MouseEvent } from "react";
 


export function Footer() {
  const currentYear = new Date().getFullYear();
  
  const onAnchorClick = (e: MouseEvent, hash: string) => {
    e.preventDefault();
    const ok = smoothScrollToHash(hash);
    if (ok) {
      try {
        window.history.replaceState(null, "", `/${hash}`);
      } catch {}
    } else {
      window.location.href = `/${hash}`;
    }
  };

  return (
    <footer className="w-full border-t border-zinc-800 bg-black">
      <div className="keystone-container py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 sm:gap-12 text-center sm:text-left">
          {/* Logo and tagline */}
          <div className="flex flex-col items-center sm:items-start gap-4">
            <Link href="/" className="flex items-center space-x-2">
              <Image
                src="https://d1uh4o7rpdqkkl.cloudfront.net/logos/keystone.webp"
                alt="Keystone Logo"
                width={40}
                height={40}
                className="h-8 w-8"
              />
              <span className="font-bold text-white">Keystone</span>
            </Link>
            <p className="text-sm text-zinc-400">
              Your AI maintenance crew.
            </p>
            <div className="flex gap-4 mt-2">
              <Link href="https://x.com/thepablohansen" aria-label="Twitter">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-zinc-400 hover:text-white transition-colors">
                  <path d="M22 4.01C21 4.5 20.02 4.69 19 4.82C20.05 4.11 20.82 2.97 21.2 1.6C20.22 2.27 19.12 2.74 18 2.95C17.09 1.81 15.76 1.11 14.25 1.11C11.31 1.11 8.95 3.48 8.95 6.42C8.95 6.9 9 7.36 9.11 7.79C4.78 7.59 0.85 5.44 -2.18557e-07 2.4C-0.34 3.29 -0.5 4.29 -0.5 5.34C-0.5 7.35 0.49 9.12 1.99 10.12C1.17 10.09 0.37 9.87 -0.3 9.5V9.53C-0.3 12.1 1.5 14.25 3.96 14.79C3.36 14.94 2.73 15.02 2.1 15.02C1.66 15.02 1.22 14.99 0.8 14.91C1.68 17.01 3.66 18.5 6 18.54C4.16 19.9 2.15 20.7 -0.02 20.7C-0.42 20.7 -0.82 20.68 -1.22 20.63C1.15 22.07 3.88 22.88 6.82 22.88C14.25 22.88 18.35 16.84 18.35 11.58L18.33 10.92C19.33 10.12 20.17 9.12 20.83 8C19.9 8.4 18.9 8.65 17.9 8.77L22 4.01Z" fill="currentColor" />
                </svg>
              </Link>
              <Link href="https://www.linkedin.com/company/withkeystone" aria-label="LinkedIn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-zinc-400 hover:text-white transition-colors">
                  <path d="M19 3C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19ZM18.5 18.5V13.2C18.5 12.3354 18.1565 11.5062 17.5452 10.8948C16.9338 10.2835 16.1046 9.94 15.24 9.94C14.39 9.94 13.4 10.46 12.92 11.24V10.13H10.13V18.5H12.92V13.57C12.92 12.8 13.54 12.17 14.31 12.17C14.6813 12.17 15.0374 12.3175 15.2999 12.5801C15.5625 12.8426 15.71 13.1987 15.71 13.57V18.5H18.5ZM6.88 8.56C7.32556 8.56 7.75288 8.383 8.06794 8.06794C8.383 7.75288 8.56 7.32556 8.56 6.88C8.56 5.95 7.81 5.19 6.88 5.19C6.43178 5.19 6.00193 5.36805 5.68499 5.68499C5.36805 6.00193 5.19 6.43178 5.19 6.88C5.19 7.81 5.95 8.56 6.88 8.56ZM8.27 18.5V10.13H5.5V18.5H8.27Z" fill="currentColor" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Navigation links (only valid anchors) */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <h4 className="font-medium text-base text-white">Navigation</h4>
            <Link href="/#how-it-works" className="text-sm text-zinc-400 hover:text-white transition-colors" onClick={(e) => onAnchorClick(e as unknown as MouseEvent, '#how-it-works')}>
              How it works
            </Link>
            {/* <Link href="https://docs.withkeystone.com" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Docs
            </Link> */}
            {/* <Link href="https://status.withkeystone.com" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Status
            </Link> */}
          </div>

          {/* Get started */}
          <div className="flex flex-col items-center sm:items-start gap-3">
            <h4 className="font-medium text-base text-white">Contact</h4>
            <Link href="mailto:founders@withkeystone.com" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Contact
            </Link>
            {/* <div className="flex gap-3 mt-2">
              <Link href="https://github.com/withkeystone" aria-label="GitHub">
                <svg className="h-5 w-5 text-zinc-400 hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.43 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.04.13 3 .4c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58C20.57 21.8 24 17.31 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </Link>
              <Link href="https://slack.com/withkeystone" aria-label="Slack">
                <svg className="h-5 w-5 text-zinc-400 hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                </svg>
              </Link>
            </div> */}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-center sm:justify-between items-center gap-4 mt-12 pt-8 border-t border-zinc-800">
          <p className="text-sm text-zinc-500 text-center">
            © {currentYear} Keystone. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
} 