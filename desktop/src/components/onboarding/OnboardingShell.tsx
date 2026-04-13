import type { ReactNode } from "react";
import {
  ONBOARDING_COPY,
  type OnboardingStepKind,
} from "@/config/onboarding";

interface OnboardingShellProps {
  stepKind: OnboardingStepKind;
  children: ReactNode;
}

export function OnboardingShell({ stepKind, children }: OnboardingShellProps) {
  const stickyHeader = stepKind === "recommendations";

  return (
    <div
      className="min-h-screen overflow-y-auto bg-background p-8"
      data-tauri-drag-region="true"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 pt-16">
        <div
          className={[
            "w-full text-center",
            stickyHeader
              ? "sticky top-0 z-10 bg-background/95 pb-4 pt-1 backdrop-blur-sm"
              : "",
          ].join(" ")}
        >
          <div className="w-full space-y-2 text-center">
            <h1 className="mx-auto max-w-[17ch] text-3xl font-semibold leading-tight text-foreground [text-wrap:balance]">
              {ONBOARDING_COPY.stepTitles[stepKind]}
            </h1>
            <p className="mx-auto max-w-xl text-base text-muted-foreground">
              {ONBOARDING_COPY.stepDescriptions[stepKind]}
            </p>
          </div>
        </div>

        <div className="w-full">{children}</div>
      </div>
    </div>
  );
}
