// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSupportSurface } from "./CloudSupportSurface";

const support = vi.hoisted(() => ({
  client: { requestJson: vi.fn() },
  sendSupportMessage: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  sendSupportMessage: support.sendSupportMessage,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudClient: () => support.client,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CloudSupportSurface", () => {
  it("sends support messages with app-provided context", async () => {
    support.sendSupportMessage.mockResolvedValue(undefined);

    render(
      <CloudSupportSurface
        context={{
          source: "settings",
          intent: "general",
          pathname: "/settings/support",
        }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What happened?"), {
      target: { value: "The workspace stopped syncing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send support message" }));

    await waitFor(() => {
      expect(support.sendSupportMessage).toHaveBeenCalledWith(
        {
          message: "The workspace stopped syncing.",
          context: {
            source: "settings",
            intent: "general",
            pathname: "/settings/support",
          },
        },
        support.client,
      );
    });
    expect(screen.queryByText("Support message sent.")).not.toBeNull();
  });
});
