import { Github } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

import { useAuthToken } from "../../../providers/WebCloudProvider";

export function ConnectGitHubScreen() {
  const { clearToken } = useAuthToken();

  return (
    <div className="flex h-full items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-[390px] text-center">
        <div className="mx-auto flex size-[58px] items-center justify-center rounded-lg border border-border bg-card">
          <Github size={22} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Connect GitHub</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          GitHub is required before cloud workspaces, automations, and shared
          sessions are available.
        </p>
        <div className="mt-8 grid gap-2">
          <Button
            className="h-[54px] w-full justify-center rounded-lg border-border bg-card text-[15px]"
            variant="secondary"
            disabled
            title="GitHub linking lands with the server callback in the auth implementation PR."
          >
            <Github size={15} />
            Continue with GitHub
          </Button>
          <Button className="h-10 justify-center" variant="ghost" onClick={clearToken}>
            Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}
