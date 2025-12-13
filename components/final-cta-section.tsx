import { WaitlistForm } from "./waitlist-form";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function FinalCTASection() {
  return (
    <section className="py-24 bg-zinc-950 border-t border-zinc-800">
      <div className="proliferate-container text-center px-5">
        <h2 className="text-2xl md:text-4xl font-bold text-white mb-4">
          Stop finding out about bugs from customer emails
        </h2>
        <p className="text-lg text-zinc-400 mb-8 max-w-2xl mx-auto">
          Your biggest accounts deserve better than aggregate error rates. See exactly what&apos;s happening, account by account.
        </p>
        <div className="flex justify-center">
          <WaitlistForm>
            <Button
              size="lg"
              className="h-12 px-8 text-[16px] rounded-xl bg-white text-black hover:bg-gray-100 font-medium border-[0.5px] border-white/20 inline-flex items-center justify-center"
              style={{boxShadow: 'rgba(255, 255, 255, 0.04) 0px 3px 3px, rgba(255, 255, 255, 0.05) 0px 1px 2px, rgba(0, 0, 0, 0.05) 0px 6px 12px inset, rgba(0, 0, 0, 0.15) 0px 1px 1px inset'}}
            >
              Join early access
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </WaitlistForm>
        </div>
      </div>
    </section>
  );
}