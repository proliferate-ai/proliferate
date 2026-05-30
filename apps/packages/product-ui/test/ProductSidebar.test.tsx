// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductSidebar } from "../src/sidebar/ProductSidebar";

describe("ProductSidebar", () => {
  afterEach(cleanup);

  it("renders nav, workspace, chat, and account view models", () => {
    const onNavSelect = vi.fn();
    const onWorkspaceSelect = vi.fn();
    const onChatSelect = vi.fn();
    const onGroupToggle = vi.fn();
    const onAction = vi.fn();

    const { container } = render(
      <ProductSidebar
        brand={<span>P</span>}
        title="Proliferate"
        headerLeadingAction={{ id: "toggle-sidebar", label: "Hide sidebar", icon: <span>Toggle</span> }}
        navItems={[
          { id: "home", label: "Home", icon: <span>H</span>, active: true, shortcutLabel: "⌘B" },
          { id: "settings", label: "Settings", icon: <span>S</span>, active: false },
        ]}
        workspaceGroups={[
          {
            id: "shared",
            sectionLabel: "Shared",
            label: "Shared cloud",
            count: 1,
            collapsed: false,
            actions: [{ id: "new", label: "New chat" }],
            rows: [
              {
                id: "chat-1",
                label: "Investigate worker CI",
                subtitle: "proliferate-ai/proliferate",
                active: false,
                status: <span aria-label="running" />,
                detail: <span aria-label="detail">D</span>,
                trailingLabel: "Slack",
                shortcutLabel: "⌥⌘1",
                actions: [{ id: "more", label: "More" }],
              },
            ],
          },
        ]}
        chatRows={[
          {
            id: "claim-1",
            label: "Claimable Slack thread",
            subtitle: "Shared cloud",
            trailingLabel: "Claimable",
          },
        ]}
        account={{
          label: "Pablo",
          detail: "pablo@example.com",
          initials: "PH",
          actions: [{ id: "settings", label: "Settings" }],
        }}
        onNavSelect={onNavSelect}
        onWorkspaceSelect={onWorkspaceSelect}
        onChatSelect={onChatSelect}
        onGroupToggle={onGroupToggle}
        onAction={onAction}
        shortcutRevealVisible
      />,
    );

    expect(container.innerHTML).toContain("bg-sidebar");
    expect(container.innerHTML).not.toContain("bg-sidebar-background");
    expect(screen.getByText("Proliferate")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getAllByText("Shared cloud").length).toBeGreaterThan(0);
    expect(screen.getByText("Investigate worker CI")).toBeTruthy();
    expect(screen.getByText("Claimable Slack thread")).toBeTruthy();
    expect(
      screen.getByText("Repositories").compareDocumentPosition(screen.getByText("Threads"))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Pablo")).toBeTruthy();
    expect(screen.getByText("⌘B").className).toContain("opacity-100");
    expect(screen.getByText("⌥⌘1").className).toContain("opacity-100");
    expect(screen.getByText("Slack").parentElement?.className).toContain("ml-[5px]");

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(onAction).toHaveBeenCalledWith({ scope: "header", actionId: "toggle-sidebar" });

    fireEvent.click(screen.getByText("Settings"));
    expect(onNavSelect).toHaveBeenCalledWith("settings");

    fireEvent.click(screen.getByText("Investigate worker CI"));
    expect(onWorkspaceSelect).toHaveBeenCalledWith("chat-1");

    fireEvent.click(screen.getByText("Claimable Slack thread"));
    expect(onChatSelect).toHaveBeenCalledWith("claim-1");
  });

  it("can render workspace rows without a group header", () => {
    render(
      <ProductSidebar
        navItems={[]}
        workspaceSectionLabel="Recents"
        workspaceGroups={[
          {
            id: "recents",
            label: "Recent work",
            count: 1,
            collapsed: false,
            headerHidden: true,
            actions: [],
            rows: [
              {
                id: "chat-1",
                label: "Recent chat",
                active: false,
                actions: [],
              },
            ],
          },
        ]}
        onNavSelect={vi.fn()}
        onWorkspaceSelect={vi.fn()}
        onGroupToggle={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Recents")).toBeTruthy();
    expect(screen.getByText("Recent chat")).toBeTruthy();
    expect(screen.queryByText("Recent work")).toBeNull();
  });
});
