import { useState } from "react";
import { Button, Copy, IconButton, ScriptBlock } from "@proliferate/ui";

const SETUP_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm prisma generate
cargo fetch --locked`;

const PLACEHOLDER = "pnpm install\npnpm prisma generate";

export const SetupScript = () => {
  const [value, setValue] = useState(SETUP_SCRIPT);
  return (
    <div className="w-full max-w-2xl">
      <ScriptBlock
        ariaLabel="Cloud setup script"
        fileLabel="setup.sh"
        value={value}
        placeholder={PLACEHOLDER}
        onChange={setValue}
        className="w-full"
      />
      <p className="mt-2 text-ui-sm text-muted-foreground">
        Runs once when a cloud workspace is created.
      </p>
    </div>
  );
};

export const EmptyWithPlaceholder = () => {
  const [value, setValue] = useState("");
  return (
    <div className="w-full max-w-2xl">
      <ScriptBlock
        ariaLabel="Local setup script"
        fileLabel="setup.sh"
        value={value}
        placeholder={PLACEHOLDER}
        onChange={setValue}
        className="w-full"
      />
    </div>
  );
};

export const WithHeaderAction = () => {
  const [value, setValue] = useState(
    "export PROLIFERATE_BASE_REF=main\nmake dev-deps\nmake migrate",
  );
  return (
    <div className="w-full max-w-2xl">
      <ScriptBlock
        ariaLabel="Cloud setup script"
        fileLabel="setup.sh"
        value={value}
        onChange={setValue}
        className="w-full"
        headerAction={
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm">
              Detect
            </Button>
            <IconButton aria-label="Copy script" size="sm">
              <Copy className="icon-paired" />
            </IconButton>
          </div>
        }
      />
    </div>
  );
};

export const Disabled = () => (
  <div className="w-full max-w-2xl">
    <ScriptBlock
      ariaLabel="Cloud setup script"
      fileLabel="setup.sh"
      value={"pnpm install --frozen-lockfile\npnpm build"}
      disabled
      onChange={() => undefined}
      className="w-full"
    />
    <p className="mt-2 text-ui-sm text-muted-foreground">
      Sign in to Proliferate Cloud to edit this script.
    </p>
  </div>
);
