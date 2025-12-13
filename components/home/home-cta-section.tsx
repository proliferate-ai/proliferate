"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WaitlistForm } from "@/components/waitlist-form";
import { TalkToFounderModal } from "@/components/talk-to-founder-modal";
import { ChevronRight } from "lucide-react";

export function HomeCTASection() {
  const [isTalkOpen, setIsTalkOpen] = useState(false);

  return (
    <section className="py-24 md:py-32 bg-black border-t border-white/5">
      <div className="proliferate-container">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Stop digging. Start fixing.
          </h2>
          <p className="text-white/40 mt-4 mb-8">
            Join fast-moving teams who ship with confidence.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <WaitlistForm>
              <Button
                size="lg"
                className="h-12 px-6 text-base rounded-full bg-white text-black hover:bg-gray-100 font-medium inline-flex items-center justify-center gap-2"
              >
                Join early access
                <ChevronRight className="w-4 h-4" />
              </Button>
            </WaitlistForm>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-6 text-base rounded-full border-white/20 bg-white/5 hover:bg-white/10 text-white font-medium"
              onClick={() => setIsTalkOpen(true)}
            >
              Talk to us
            </Button>
          </div>
        </div>
      </div>

      <TalkToFounderModal open={isTalkOpen} onOpenChange={setIsTalkOpen} />
    </section>
  );
}
