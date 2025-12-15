"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function HomeAnnouncementBadge() {
  return (
    <div className="relative h-8">
      <Link
        href="/blog"
        className="flex items-center gap-2 h-7 px-3.5 pr-2 rounded-full bg-black/10 backdrop-blur-2xl border border-white/10 hover:bg-white/10 transition-colors"
      >
        {/* Dot indicator */}
        <div className="relative w-2 h-2">
          <div className="absolute inset-0.5 bg-white rounded-full" />
        </div>

        {/* Text */}
        <span className="text-xs text-white uppercase tracking-wide">
          Launching soon - Join us
        </span>

        {/* Arrow */}
        <ChevronRight className="w-3 h-3 text-white/60" />
      </Link>
    </div>
  );
}
