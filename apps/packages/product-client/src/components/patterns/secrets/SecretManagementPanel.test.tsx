// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretManagementPanel } from "./SecretManagementPanel";

afterEach(cleanup);

describe("SecretManagementPanel actions", () => {
  it("uses the type-specific add actions without a redundant panel action", () => {
    render(
      <SecretManagementPanel
        title="Organization secrets"
        description="Available in every member's cloud sandbox."
        filePathMode="absolute"
        envVars={[]}
        files={[]}
        onSaveEnvVar={vi.fn()}
        onDeleteEnvVar={vi.fn()}
        onSaveFile={vi.fn()}
        onDeleteFile={vi.fn()}
      />,
    );

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add variable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add file" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add secret" })).toBeNull();
  });
});
