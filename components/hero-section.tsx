"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { WaitlistForm } from "./waitlist-form";
import { TalkToFounderModal } from "./talk-to-founder-modal";
import SignalPond from "./proliferation-effect";

export function HeroSection() {
  const [isTalkOpen, setIsTalkOpen] = useState(false);

  return (
    <section className="relative overflow-hidden pb-10  pt-20">
      <div className="proliferate-container mx-auto">
        <div className="flex flex-col items-center justify-center">
          <div className="flex flex-col items-center text-left max-w-6xl">
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-4">
              <div className="w-full">
                {/* <span className="mb-4 text-xs font-semibold tracking-tight text-gray-400 uppercase">
                  The next generation
                </span> */}
                <h1 className="mb-4 text-left lg:-mr-10 text-[clamp(1.6rem,4vw,3.5rem)] font-bold tracking-[-0.04em] text-white leading-[1] sm:leading-[1.1]">
                  The next generation
                  <br />
                  of error monitoring
                </h1>

                <p className="mt-4 mb-8 max-w-[42rem] text-sm sm:text-base text-gray-400 opacity-90">
                  Stop struggling to understand why your product is breaking. Stop digging through logs. Adopt modern observability.
                  {/* Proliferate is the observability platform that shows you exactly what&apos;s happening for each account. See who&apos;s struggling, why, and fix it before they email you. */}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start justify-start w-full sm:w-auto">
                  <div className="flex  flex-col w-full sm:w-auto">
                    <WaitlistForm>
                      <Button
                        size="lg"
                        className="h-12 sm:h-11 px-6 text-[16px] rounded-xl bg-white text-black hover:bg-gray-100 font-medium border-[0.5px] border-white/20 inline-flex items-center justify-center w-full sm:w-auto"
                        style={{ boxShadow: 'rgba(255, 255, 255, 0.04) 0px 3px 3px, rgba(255, 255, 255, 0.05) 0px 1px 2px, rgba(0, 0, 0, 0.05) 0px 6px 12px inset, rgba(0, 0, 0, 0.15) 0px 1px 1px inset' }}
                      >
                        Join early access
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </WaitlistForm>
                    <p className="mt-2 text-[11px] text-gray-500 text-center">Built for B2B teams who can&apos;t afford to lose a pilot</p>
                  </div>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 sm:h-11 px-6 text-[16px] rounded-xl border-gray-700/50 bg-transparent hover:bg-white/5 text-gray-300 hover:text-white font-medium w-full sm:w-auto"
                    style={{ boxShadow: 'none' }}
                    onClick={() => setIsTalkOpen(true)}
                  >
                    Talk to founder
                  </Button>
                </div>
              </div>

              <div className="w-full">
                <SignalPond />
              </div>
            </div>

          </div>

        </div>
      </div>
      <TalkToFounderModal open={isTalkOpen} onOpenChange={setIsTalkOpen} />
    </section>
  );
}
