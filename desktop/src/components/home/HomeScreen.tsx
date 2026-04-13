import { ProliferateLogo } from "@/components/brand/ProliferateLogo";
import { Check, CircleAlert, Clock, Folder, LoaderCircle, Settings } from "@/components/ui/icons";
import type { HomeStatusIcon } from "@/lib/domain/home/home-screen";
import { Button } from "@/components/ui/Button";
import { useHomeScreen } from "@/hooks/home/use-home-screen";
import { useHomeOnboardingLanding } from "@/hooks/home/use-home-onboarding-landing";
import { HomeActionCard } from "./HomeActionCard";

function resolveStatusIcon(icon: HomeStatusIcon) {
  switch (icon) {
    case "spinner":
      return <LoaderCircle className="size-3.5 animate-spin" />;
    case "check":
      return <Check className="size-3.5" />;
    case "warning":
      return <CircleAlert className="size-3.5" />;
  }
}

function resolveActionIcon(actionId: "resume-last-workspace" | "add-repository" | "agent-settings" | "repository-settings") {
  switch (actionId) {
    case "resume-last-workspace":
      return <Clock className="size-4" />;
    case "add-repository":
      return <Folder className="size-4" />;
    case "agent-settings":
    case "repository-settings":
      return <Settings className="size-4" />;
  }
}

export function HomeScreen() {
  const {
    actionCards,
    statusMessage,
    isAddingRepo,
    handleHomeAction,
  } = useHomeScreen();
  const onboardingLanding = useHomeOnboardingLanding();

  return (
    <div className="flex-1 bg-background h-full relative overflow-auto">
      <div className="absolute inset-x-0 top-0 h-10" data-tauri-drag-region="true" />

      <div className="mx-auto min-h-full max-w-5xl px-6 pb-16 pt-24 md:pt-40 lg:pt-52">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex h-20 w-full items-center justify-between gap-6">
            <ProliferateLogo />
          </div>
          {onboardingLanding.active && onboardingLanding.heroTitle && (
            <div className="mt-6 space-y-2">
              <p className="text-xl font-medium text-foreground">
                {onboardingLanding.heroTitle}
              </p>
              {onboardingLanding.heroDetail && (
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {onboardingLanding.heroDetail}
                </p>
              )}
            </div>
          )}
          <div className="mt-8 w-full max-w-[760px]">
            <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-3">
              {actionCards.map((action) => (
                <HomeActionCard
                  key={action.id}
                  title={action.title}
                  description={action.description}
                  icon={resolveActionIcon(action.id)}
                  loading={action.id === "add-repository" && isAddingRepo}
                  onClick={() => handleHomeAction(action.id)}
                />
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {statusMessage ? (
              <p className="flex items-center gap-1.5">
                {statusMessage.icon && resolveStatusIcon(statusMessage.icon)}
                <span>
                  {statusMessage.text}{" "}
                  {statusMessage.actionId && statusMessage.actionLabel
                    ? (
                      <Button
                        variant="ghost"
                        onClick={() => handleHomeAction(statusMessage.actionId!)}
                        className="inline h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-muted-foreground"
                      >
                        {statusMessage.actionLabel}
                      </Button>
                    )
                    : null}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
