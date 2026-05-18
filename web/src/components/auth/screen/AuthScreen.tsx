import { useState } from "react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

export function AuthScreen() {
  const { setToken } = useAuthToken();
  const [manualToken, setManualToken] = useState("");

  return (
    <div className="flex h-full items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-lg border border-border bg-card">
            <ProliferateMark size={30} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold">Proliferate</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Run and orchestrate coding agents from cloud surfaces.
          </p>
        </div>

        <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
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
      </section>
    </div>
  );
}
