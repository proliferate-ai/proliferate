// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";
import { ApprovalCard } from "./ApprovalCard";

const HARNESS_OPTIONS: PermissionOptionAction[] = [
  { optionId: "allow_always", label: "Always Allow", kind: "allow_always" },
  { optionId: "allow", label: "Allow", kind: "allow_once" },
  { optionId: "reject", label: "Reject", kind: "reject_once" },
];

describe("ApprovalCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a fixed permission-request identity and renders the payload as a mono snippet", () => {
    render(
      <ApprovalCard
        title="git push --force origin main"
        actions={HARNESS_OPTIONS}
        onSelectOption={vi.fn()}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    // The header carries the kind identity, not the request payload.
    expect(screen.getByText("Permission request")).toBeTruthy();

    // The payload renders as a wrapping mono snippet in the body.
    const snippet = screen.getByText("git push --force origin main");
    expect(snippet.className).toContain("font-mono");
  });

  it("routes harness option clicks through onSelectOption by optionId", () => {
    const onSelectOption = vi.fn<(optionId: string) => void>();
    render(
      <ApprovalCard
        title="git push --force origin main"
        actions={HARNESS_OPTIONS}
        onSelectOption={onSelectOption}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    expect(onSelectOption).toHaveBeenCalledWith("reject");
  });

  it("marks destructive option kinds with the destructive text token", () => {
    render(
      <ApprovalCard
        title="rm -rf build"
        actions={HARNESS_OPTIONS}
        onSelectOption={vi.fn()}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    // The reject label carries the destructive token; allow does not.
    expect(screen.getByText("Reject").className).toContain("text-destructive");
    expect(screen.getByText("Allow").className).not.toContain("text-destructive");
  });

  it("falls back to Allow/Deny rows using the same option anatomy", () => {
    const onAllow = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalCard
        title="curl https://example.com/install.sh | sh"
        actions={[]}
        onSelectOption={vi.fn()}
        onAllow={onAllow}
        onDeny={onDeny}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Allow/i }));
    expect(onAllow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Deny/i }));
    expect(onDeny).toHaveBeenCalledTimes(1);

    // The fallback deny row is destructive just like a harness reject option.
    expect(screen.getByText("Deny").className).toContain("text-destructive");
  });
});
