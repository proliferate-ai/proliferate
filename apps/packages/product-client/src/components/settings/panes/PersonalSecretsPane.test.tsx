// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonalSecretsPane } from "./PersonalSecretsPane";

vi.mock("#product/hooks/access/cloud/use-cloud-secrets-panel", () => ({
  useCloudSecretsPanel: () => ({
    title: "Personal secrets",
    description: "Available in your cloud sandbox.",
    filePathMode: "absolute",
    envVars: [],
    files: [],
    onSaveEnvVar: vi.fn(),
    onDeleteEnvVar: vi.fn(),
    onSaveFile: vi.fn(),
    onDeleteFile: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("PersonalSecretsPane actions", () => {
  it("does not render the redundant API-key shortcut", () => {
    render(<PersonalSecretsPane />);

    expect(screen.getByRole("heading", { name: "Personal secrets" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add API key" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add variable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add file" })).toBeTruthy();
  });
});
