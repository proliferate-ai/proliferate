import { useBrailleSweep } from "@/hooks/ui/use-braille-sweep";

interface OnboardingBrailleLoaderProps {
  title: string;
  detail: string;
}

// Braille loading hero shown on the Recommendations step while agent
// registries are still warming up. Uses the same useBrailleSweep ticker as
// the chat transcript's StreamingIndicator and ChatLoadingHero so every
// loading surface in the app animates in lockstep.
export function OnboardingBrailleLoader({ title, detail }: OnboardingBrailleLoaderProps) {
  const frame = useBrailleSweep();

  return (
    <div className="flex flex-col items-center text-center">
      <span
        aria-hidden
        className="font-mono text-5xl leading-none tracking-[-0.18em] text-foreground"
      >
        {frame}
      </span>
      <p className="mt-5 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
