"use client";

import { useState } from "react";
import { TalkToFounderModal } from "./talk-to-founder-modal";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

export function FinalCTASection() {
  const [isTalkOpen, setIsTalkOpen] = useState(false);

  return (
    <section className="bg-black px-6 pt-24 pb-16 text-center">
      {/* Gradient Headline */}
      <h2
        className="text-[clamp(2.5rem,8vw,4.5rem)] leading-[1.05] font-bold tracking-[-0.02em] pb-8 bg-clip-text text-transparent"
        style={{
          backgroundImage: "linear-gradient(to right bottom, rgb(255, 255, 255) 30%, rgba(255, 255, 255, 0.5))",
        }}
      >
        Put your engineering org
        <br />
        on autopilot
      </h2>

      {/* CTA Button */}
      <div className="flex justify-center gap-4">
        <Button
          size="lg"
          className="h-12 px-6 text-base rounded-full bg-white text-black hover:bg-gray-100 font-medium inline-flex items-center justify-center gap-2"
          onClick={() => setIsTalkOpen(true)}
        >
          Request demo
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Large Logo/Wordmark */}
      <div className="mt-12 -mb-16 relative overflow-hidden">
        <p
          className="text-[clamp(4rem,15vw,10rem)] font-bold tracking-[-0.04em] text-white/[0.08] select-none"
          style={{
            maskImage: "linear-gradient(to bottom, black 20%, transparent 90%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 20%, transparent 90%)",
          }}
        >
          Proliferate
        </p>
      </div>

      <TalkToFounderModal open={isTalkOpen} onOpenChange={setIsTalkOpen} />
    </section>
  );
}