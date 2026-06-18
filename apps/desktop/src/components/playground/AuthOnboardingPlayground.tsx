import { useEffect, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { AuthScreenLayout } from "@/components/auth/AuthScreenLayout";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { SessionCheckScreen } from "@/components/auth/SessionCheckScreen";

// Dev playground for the initial-page (loading + auth) screens.
//   • "Shared layout" = the fix: ONE persistent <AuthScreenLayout> stays mounted
//     while you flip loading<->auth, so the living mark never re-mounts (its
//     animation persists) and the heading stays put — only the action slot
//     cross-fades (skeleton -> GitHub button).
//   • "Current" = today's behavior: two separate screens whose differing height
//     makes the mark jump during the loading->auth cross-fade.

type Surface = "shared" | "current";
type SharedMode = "loading" | "auth";
type CurrentView = "loading" | "auth" | "transition";

const MOCK_LOGIN_PROPS = {
  submitting: false,
  busy: false,
  error: null,
  githubSignInAvailable: true,
  githubSignInChecking: false,
  githubSignInUnavailableDescription: "",
  onGitHubSignIn: () => {},
  onContinueLocally: () => {},
  canContinueLocally: false,
} as const;

// Mirrors BootstrappedRoute's cross-fade: the auth screen renders underneath,
// the loading overlay fades out over it. If the mark/heading sit at different
// vertical positions on the two screens, you see it slide during the fade.
function TransitionReplay({ replayKey }: { replayKey: number }) {
  const [phase, setPhase] = useState<"checking" | "fading" | "done">("checking");

  useEffect(() => {
    setPhase("checking");
    const toFade = window.setTimeout(() => setPhase("fading"), 900);
    const toDone = window.setTimeout(() => setPhase("done"), 1200);
    return () => {
      window.clearTimeout(toFade);
      window.clearTimeout(toDone);
    };
  }, [replayKey]);

  return (
    <>
      <LoginScreen {...MOCK_LOGIN_PROPS} />
      {phase !== "done" && (
        <div
          className={`fixed inset-0 z-40 bg-background transition-opacity duration-200 ${
            phase === "fading" ? "opacity-0" : "opacity-100"
          }`}
        >
          <SessionCheckScreen resolving={phase === "fading"} />
        </div>
      )}
    </>
  );
}

export function AuthOnboardingPlayground() {
  const [surface, setSurface] = useState<Surface>("shared");
  const [sharedMode, setSharedMode] = useState<SharedMode>("loading");
  const [currentView, setCurrentView] = useState<CurrentView>("loading");
  const [replayKey, setReplayKey] = useState(0);

  const playTransition = () => {
    setCurrentView("transition");
    setReplayKey((key) => key + 1);
  };

  return (
    <div className="relative min-h-screen bg-background">
      {surface === "shared" ? (
        // Stays mounted across loading<->auth: mark animation is persistent.
        <AuthScreenLayout
          mode={sharedMode}
          markComplete={sharedMode === "auth"}
          {...MOCK_LOGIN_PROPS}
        />
      ) : (
        <>
          {currentView === "loading" && <SessionCheckScreen />}
          {currentView === "auth" && <LoginScreen {...MOCK_LOGIN_PROPS} />}
          {currentView === "transition" && <TransitionReplay replayKey={replayKey} />}
        </>
      )}

      <div className="fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {/* Surface switch */}
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-2 shadow-lg backdrop-blur">
          <Button
            type="button"
            size="sm"
            variant={surface === "shared" ? "primary" : "secondary"}
            onClick={() => setSurface("shared")}
          >
            Shared layout (fixed)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={surface === "current" ? "primary" : "secondary"}
            onClick={() => setSurface("current")}
          >
            Current (jumpy)
          </Button>
        </div>

        {/* Per-surface controls */}
        {surface === "shared" ? (
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-2 shadow-lg backdrop-blur">
            <span className="pr-1 text-xs text-muted-foreground">Mode</span>
            <Button
              type="button"
              size="sm"
              variant={sharedMode === "loading" ? "primary" : "secondary"}
              onClick={() => setSharedMode("loading")}
            >
              Loading
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sharedMode === "auth" ? "primary" : "secondary"}
              onClick={() => setSharedMode("auth")}
            >
              Auth
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-2 shadow-lg backdrop-blur">
            <span className="pr-1 text-xs text-muted-foreground">View</span>
            <Button
              type="button"
              size="sm"
              variant={currentView === "loading" ? "primary" : "secondary"}
              onClick={() => setCurrentView("loading")}
            >
              Loading
            </Button>
            <Button
              type="button"
              size="sm"
              variant={currentView === "auth" ? "primary" : "secondary"}
              onClick={() => setCurrentView("auth")}
            >
              Auth
            </Button>
            <Button
              type="button"
              size="sm"
              variant={currentView === "transition" ? "primary" : "secondary"}
              onClick={playTransition}
            >
              {currentView === "transition" ? "Replay transition" : "Play loading→auth"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
