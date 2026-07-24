// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptDisplayPlanPart } from "@proliferate/product-domain/chats/composer/prompt-display-parts";
import { PlanReferenceAttachmentCard } from "#product/components/workspace/chat/content/PlanReferenceAttachmentCard";

const plan: PromptDisplayPlanPart = {
  type: "plan_reference",
  id: "plan-reference-1",
  name: "Foundation plan",
  planId: "plan-1",
  title: "Foundation plan",
  bodyMarkdown: "Ship the foundation.",
  snapshotHash: "snapshot-1",
  sourceSessionId: "session-1",
  sourceKind: "plan",
};

afterEach(cleanup);

describe("PlanReferenceAttachmentCard", () => {
  it("uses a revealed row action for draft removal and stops row propagation", () => {
    const onRemove = vi.fn();
    const onParentClick = vi.fn();

    render(
      <div onClick={onParentClick}>
        <PlanReferenceAttachmentCard plan={plan} variant="draft" onRemove={onRemove} />
      </div>,
    );

    const remove = screen.getByRole("button", { name: "Remove Foundation plan" });
    expect(remove.className).toContain("size-7");
    expect(remove.className).toContain("rounded-md");
    expect(remove.className).toContain("hover:bg-hover");
    expect(remove.className).toContain("group-hover:pointer-events-auto");
    expect(remove.className).toContain("[&_svg]:icon-control");
    expect(remove.parentElement?.className).toContain("group-hover:opacity-100");

    fireEvent.click(remove);

    expect(onRemove).toHaveBeenCalledWith("plan-reference-1");
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
