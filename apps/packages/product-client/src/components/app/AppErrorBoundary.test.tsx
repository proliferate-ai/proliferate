// @vitest-environment jsdom
import { act, StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppErrorBoundary,
  type AppErrorBoundaryProps,
} from "#product/components/app/AppErrorBoundary";

function Crash({ error }: { error: Error }): never {
  throw error;
}

function renderCrash(
  props: Omit<AppErrorBoundaryProps, "children"> = {},
  error = new Error("Workspace panel failed to render"),
) {
  return render(
    <AppErrorBoundary {...props}>
      <Crash error={error} />
    </AppErrorBoundary>,
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("shows neutral reporting copy until the host confirms persistence", async () => {
    let confirmReport: ((reported: boolean) => void) | null = null;
    const onRenderError = vi.fn(
      () => new Promise<boolean>((resolve) => {
        confirmReport = resolve;
      }),
    );

    renderCrash({ onRenderError });

    expect(document.querySelector('[data-report-status="reporting"]')).toBeTruthy();
    expect(screen.queryByText("We've been notified and are investigating.")).toBeNull();
    expect(onRenderError).toHaveBeenCalledTimes(1);

    await act(async () => confirmReport?.(true));
    expect(await screen.findByText("We've been notified and are investigating.")).toBeTruthy();
    expect(document.querySelector('[data-report-status="reported"]')).toBeTruthy();
  });

  it("shows confirmed success when the host acknowledgment is already resolved", async () => {
    render(
      <StrictMode>
        <AppErrorBoundary onRenderError={async () => true}>
          <Crash error={new Error("Workspace panel failed to render")} />
        </AppErrorBoundary>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-report-status="reported"]')).toBeTruthy();
    });
    expect(screen.getByText("We've been notified and are investigating.")).toBeTruthy();
  });

  it("states honestly when reporting is unavailable or fails", async () => {
    const unavailable = renderCrash();
    expect(screen.getByText("Automatic reporting isn't available here. Copy the technical details if you need help.")).toBeTruthy();
    unavailable.unmount();

    renderCrash({ onRenderError: async () => false });
    expect(await screen.findByText("We couldn't send the diagnostic report. Copy the technical details if you need help.")).toBeTruthy();
    expect(screen.queryByText("We've been notified and are investigating.")).toBeNull();
  });

  it("keeps the recovery surface usable when reporting throws or rejects", async () => {
    const thrown = renderCrash({
      onRenderError: () => {
        throw new Error("reporter crashed");
      },
    });
    await waitFor(() => {
      expect(document.querySelector('[data-report-status="failed"]')).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
    thrown.unmount();

    renderCrash({ onRenderError: async () => Promise.reject(new Error("offline")) });
    await waitFor(() => {
      expect(document.querySelector('[data-report-status="failed"]')).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("reloads, retries, copies sanitized details, contacts support, and focuses the primary action", async () => {
    const reload = vi.fn();
    const copyDetails = vi.fn().mockResolvedValue(undefined);
    const contactSupport = vi.fn().mockResolvedValue(undefined);
    const privatePrompt = "private roadmap prompt";
    const privateTranscript = "private customer transcript";
    const privatePath = "/Users/pablohansen/private-client/App.tsx:8:3";
    let shouldCrash = true;

    function MaybeCrash() {
      if (shouldCrash) {
        throw new Error(
          `prompt=${privatePrompt}\ntranscript=${privateTranscript}\n${privatePath}`,
        );
      }
      return <p>View restored</p>;
    }

    const { container } = render(
      <AppErrorBoundary
        clientReleaseId="proliferate-desktop@1.4.2+abcdef123456"
        onReload={reload}
        onCopyDetails={copyDetails}
        onContactSupport={contactSupport}
      >
        <MaybeCrash />
      </AppErrorBoundary>,
    );

    const reloadButton = screen.getByRole("button", { name: "Reload app" });
    expect(document.activeElement).toBe(reloadButton);
    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Technical details"));
    expect(container.textContent).toContain("proliferate-desktop@1.4.2+abcdef123456");
    expect(container.textContent).not.toContain(privatePrompt);
    expect(container.textContent).not.toContain(privateTranscript);
    expect(container.textContent).not.toContain(privatePath);

    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(copyDetails).toHaveBeenCalledTimes(1));
    const copied = copyDetails.mock.calls[0][0] as string;
    expect(copied).toContain("Report status: Unavailable");
    expect(copied).not.toContain(privatePrompt);
    expect(copied).not.toContain(privateTranscript);
    expect(copied).not.toContain(privatePath);

    fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
    await waitFor(() => expect(contactSupport).toHaveBeenCalledTimes(1));

    shouldCrash = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("View restored")).toBeTruthy();
  });
});
