import { Github, KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

export function AuthScreen() {
  const { setToken } = useAuthToken();
  const [manualToken, setManualToken] = useState("");

  return (
    <div className="flex h-full items-center justify-center bg-background px-6 py-8 text-foreground">
      <section className="w-full max-w-[390px]">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="flex size-[66px] items-center justify-center rounded-lg border border-border bg-card shadow-keystone">
            <ProliferateMark size={32} />
          </div>
          <h1 className="mt-5 text-[26px] font-semibold leading-8">Proliferate</h1>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Run and orchestrate coding agents.
            <br />
            Sign in to get started.
          </p>
        </div>

        <div className="grid gap-2">
          <Button
            className="h-[54px] w-full justify-center rounded-lg border-border bg-card text-[15px]"
            variant="secondary"
            disabled
            title="GitHub browser sign-in is wired in the auth implementation PR."
          >
            <Github size={18} />
            Continue with GitHub
          </Button>
        </div>

        <div className="mt-5 grid gap-2 rounded-lg border border-border bg-card p-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <KeyRound size={13} />
            Development access
          </div>
          <Input
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            placeholder="Paste a development access token"
          />
          <Button
            variant="secondary"
            disabled={!manualToken.trim()}
            onClick={() => setToken(manualToken.trim())}
          >
            Use token
          </Button>
        </div>

        <p className="mx-auto mt-4 max-w-[290px] text-center text-[11.5px] leading-[17px] text-muted-foreground/70">
          A GitHub connection is required for cloud workspaces and automations.
        </p>
      </section>
    </div>
  );
}
