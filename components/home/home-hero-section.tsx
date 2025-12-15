"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { WaitlistForm } from "@/components/waitlist-form";
import { TalkToFounderModal } from "@/components/talk-to-founder-modal";
import { HomeAnnouncementBadge } from "./home-announcement-badge";
import { HomeCompanyLogos } from "./home-company-logos";
import { ChevronRight } from "lucide-react";

export function HomeHeroSection() {
  const [isTalkOpen, setIsTalkOpen] = useState(false);

  return (
    <section className="relative w-full h-screen max-h-screen bg-black min-[810px]:min-h-[800px] -mt-14">
      {/* Background Image */}
      <div
        className="absolute inset-0 opacity-80"
        style={{ imageRendering: "pixelated" }}
      >
        <div className="absolute inset-0">
          <Image
            className="object-cover w-full h-full"
            src="https://d1uh4o7rpdqkkl.cloudfront.net/hero.webp"
            alt="Background"
            fill
            priority
            unoptimized
          />
        </div>
      </div>

      {/* Gradient Overlay */}
      <div className="absolute bottom-0 left-0 w-full h-1/4 bg-gradient-to-t from-black to-transparent mix-blend-multiply" />

      {/* Main Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
        <div
          className="flex flex-col items-center gap-6 w-full max-w-5xl"
          style={{
            animation: 'fadeIn 0.8s ease-out forwards',
            opacity: 0,
          }}
        >
          {/* Announcement Badge */}
          <HomeAnnouncementBadge />

          {/* Headlines */}
          <div className="flex flex-col items-center gap-2 text-white">
            <h1 className="text-center text-[clamp(2.4rem,6vw,5.2rem)] font-bold tracking-[-0.02em] text-white leading-[1] sm:leading-[1.1]">
              <span className="block ">
                The next generation
              </span>
              <span className="block mt-2">
                of error monitoring.
              </span>

            </h1>
            <h2 className="text-lg sm:text-xl text-white/80 mt-4 text-center max-w-md">
              Modern observability for AI-native teams
            </h2>
          </div>

          {/* CTA Button */}
          <div className="flex gap-4">
            <WaitlistForm>
              <Button
                size="lg"
                className="h-12 px-6 text-base rounded-full bg-white text-black hover:bg-gray-100 font-medium inline-flex items-center justify-center gap-2"
              >
                Join early access
                <ChevronRight className="w-4 h-4" />
              </Button>
            </WaitlistForm>
            {/* <Button
              size="lg"
              variant="outline"
              className="h-12 px-6 text-base rounded-full border-white/20 bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white font-medium"
              onClick={() => setIsTalkOpen(true)}
            >
              Talk to us
            </Button> */}
          </div>
        </div>

        {/* Company Logos */}
        <div className="absolute pointer-events-none bottom-16 left-1/2 -translate-x-1/2 w-full max-w-5xl px-4">
          <HomeCompanyLogos />
        </div>
      </div>

      <TalkToFounderModal open={isTalkOpen} onOpenChange={setIsTalkOpen} />
    </section>
  );
}
