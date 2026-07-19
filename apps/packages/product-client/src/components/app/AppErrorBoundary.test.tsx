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

function Crash({ error }: { error: unknown }): never {
  throw error;
}

function renderCrash(
  props: Omit<AppErrorBoundaryProps, "children"> = {},
  error: unknown = new Error("Workspace panel failed to render"),
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

    await screen.findByRole("button", { name: "Reload app" });
    expect(
      document.querySelector('[data-report-status="reporting"]'),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).not.toContain(
      "we've been notified",
    );
    expect(onRenderError).toHaveBeenCalledTimes(1);

    await act(async () => confirmReport?.(true));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Reported — we've been notified and are investigating.",
      );
    });
    expect(
      document.querySelector('[data-report-status="reported"]'),
    ).toBeTruthy();
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
    await screen.findByRole("button", { name: "Reload app" });
    expect(screen.getByRole("status").textContent).toBe(
      "Reported — we've been notified and are investigating.",
    );
  });

  it("states honestly when reporting is unavailable or fails", async () => {
    const unavailable = renderCrash();
    await screen.findByRole("button", { name: "Reload app" });
    expect(screen.getByRole("status").textContent).toBe(
      "Reporting unavailable — automatic reporting isn't available here. Copy the technical details if you need help.",
    );
    unavailable.unmount();

    renderCrash({ onRenderError: async () => false });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Report failed — we couldn't send the diagnostic report. Copy the technical details if you need help.",
      );
    });
    expect(screen.getByRole("status").textContent).not.toContain(
      "we've been notified",
    );
  });

  it("keeps completed states neutral, compact, and free of decorative icons", async () => {
    renderCrash({
      onRenderError: async () => true,
      onContactSupport: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Reported — we've been notified and are investigating.",
      );
    });
    const surface = document.querySelector('[data-crash-recovery]');
    const status = screen.getByRole("status");

    expect(status.getAttribute("data-report-appearance")).toBe("neutral");
    expect(status.className).not.toMatch(
      /(?:bg|border)-(?:success|green|destructive|red)/u,
    );
    expect(surface?.querySelectorAll("svg")).toHaveLength(0);
    for (const name of [
      "Reload app",
      "Try again",
      "Copy details",
      "Contact support",
    ]) {
      expect(screen.getByRole("button", { name }).querySelector("svg")).toBeNull();
    }

    const details = screen.getByText("Technical details").closest("details");
    expect(details?.open).toBe(false);
  });

  it("uses only the functional progress affordance while reporting", async () => {
    renderCrash({ onRenderError: () => new Promise<boolean>(() => {}) });

    await screen.findByRole("button", { name: "Reload app" });
    expect(document.querySelectorAll("[data-loading-spinner]")).toHaveLength(1);
    expect(document.querySelectorAll('[data-crash-recovery] svg')).toHaveLength(1);
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

  it.each([
    ["falsy zero", 0],
    ["falsy false", false],
    ["non-Error string", "private unlabeled customer transcript"],
  ])("recovers safely from a %s thrown value", async (_name, thrownValue) => {
    const onRenderError = vi.fn(async () => true);
    renderCrash({ onRenderError }, thrownValue);

    await screen.findByRole("button", { name: "Reload app" });
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("Unexpected render error")).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "private unlabeled customer transcript",
    );
    expect(onRenderError).toHaveBeenCalledWith(
      expect.objectContaining({ error: thrownValue }),
    );
  });

  it("reloads, retries, copies sanitized details, contacts support, and focuses the primary action", async () => {
    const reload = vi.fn();
    const copyDetails = vi.fn().mockResolvedValue(undefined);
    const contactSupport = vi.fn().mockResolvedValue(undefined);
    const privatePrompt = "private roadmap prompt";
    const privateTranscript = "private customer transcript";
    const privateCredential = "tiny-credential";
    const privateQuerySecret = "short-query-secret";
    const privatePath = "/Users/pablohansen/private-client/App.tsx:8:3";
    const privateUncPath = "\\\\corp-server\\private-share\\App.tsx";
    let shouldCrash = true;

    function MaybeCrash() {
      if (shouldCrash) {
        throw new Error(
          `prompt=${privatePrompt}\ntranscript=${privateTranscript}\ntoken=${privateCredential}\nhttps://api.example.test/jobs?client_secret=${privateQuerySecret}\n${privatePath}\n${privateUncPath}`,
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

    const reloadButton = await screen.findByRole("button", { name: "Reload app" });
    expect(document.activeElement).toBe(reloadButton);
    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Technical details"));
    expect(container.textContent).toContain("proliferate-desktop@1.4.2+abcdef123456");
    for (const privateValue of [
      privatePrompt,
      privateTranscript,
      privateCredential,
      privateQuerySecret,
      privatePath,
      privateUncPath,
    ]) {
      expect(container.textContent).not.toContain(privateValue);
    }

    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(copyDetails).toHaveBeenCalledTimes(1));
    const copied = copyDetails.mock.calls[0][0] as string;
    expect(copied).toContain("Report status: Unavailable");
    for (const privateValue of [
      privatePrompt,
      privateTranscript,
      privateCredential,
      privateQuerySecret,
      privatePath,
      privateUncPath,
    ]) {
      expect(copied).not.toContain(privateValue);
    }

    fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
    await waitFor(() => expect(contactSupport).toHaveBeenCalledTimes(1));

    shouldCrash = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("View restored")).toBeTruthy();
  });
});
