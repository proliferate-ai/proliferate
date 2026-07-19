// @vitest-environment jsdom

import { useLayoutEffect, useRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptAttachmentViewer } from "#product/components/workspace/files/PromptAttachmentViewer";
import {
  promptAttachmentViewerTarget,
  type ViewerTarget,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

const queryCache = vi.hoisted(() => new Map<string, Blob>());

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: null, cloud: { client: null } }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useFetchPromptAttachmentMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({
    queryKey,
    enabled,
  }: {
    queryKey: readonly [string, string | null, string | null];
    enabled: boolean;
  }) => {
    const data = enabled
      ? queryCache.get(queryIdentity(queryKey[1], queryKey[2]))
      : undefined;
    return {
      data,
      isLoading: enabled && !data,
      isSuccess: !!data,
      isError: false,
      error: null,
      status: data ? "success" : "pending",
      fetchStatus: "idle",
    };
  },
}));

type PromptAttachmentTarget = Extract<ViewerTarget, { kind: "promptAttachment" }>;

interface ViewerCommit {
  requestedName: string;
  imageName: string | null;
  imageUrl: string | null;
  isLoading: boolean;
}

describe("PromptAttachmentViewer submitted image identity", () => {
  let imageA: Blob;
  let imageB: Blob;
  let imageAcrossSession: Blob;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let serial: number;

  beforeEach(() => {
    imageA = new Blob(["image-a"], { type: "image/png" });
    imageB = new Blob(["image-b"], { type: "image/png" });
    imageAcrossSession = new Blob(["image-a-session-2"], { type: "image/png" });
    queryCache.clear();
    queryCache.set(queryIdentity("session-1", "image-a"), imageA);
    queryCache.set(queryIdentity("session-1", "image-b"), imageB);
    queryCache.set(queryIdentity("session-2", "image-a"), imageAcrossSession);
    serial = 0;
    createObjectURL = vi.fn((blob: Blob) => {
      serial += 1;
      const identity = blob === imageA
        ? "a"
        : blob === imageB
          ? "b"
          : blob === imageAcrossSession
            ? "session-2-a"
            : "replacement-a";
      return `blob:${identity}-${serial}`;
    });
    revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never renders a previous cached image under the next attachment identity", async () => {
    const commits: ViewerCommit[] = [];
    const targetA = submittedImageTarget("session-1", "image-a", "image-a.png");
    const targetB = submittedImageTarget("session-1", "image-b", "image-b.png");
    const targetAcrossSession = submittedImageTarget(
      "session-2",
      "image-a",
      "session-2-image-a.png",
    );
    const rendered = render(
      <ViewerCommitProbe target={targetA} onCommit={(commit) => commits.push(commit)} />,
    );

    await expectImage("image-a.png", "blob:a-1");
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <ViewerCommitProbe target={targetA} onCommit={(commit) => commits.push(commit)} />,
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <ViewerCommitProbe target={targetB} onCommit={(commit) => commits.push(commit)} />,
    );
    expect(latestCommit(commits, "image-b.png")).toMatchObject({
      imageName: null,
      imageUrl: null,
      isLoading: true,
    });
    await expectImage("image-b.png", "blob:b-2");
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === "blob:a-1")).toHaveLength(1);

    rendered.rerender(
      <ViewerCommitProbe target={targetA} onCommit={(commit) => commits.push(commit)} />,
    );
    expect(latestCommit(commits, "image-a.png")).toMatchObject({
      imageName: null,
      imageUrl: null,
      isLoading: true,
    });
    await expectImage("image-a.png", "blob:a-3");
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === "blob:b-2")).toHaveLength(1);

    rendered.rerender(
      <ViewerCommitProbe
        target={targetAcrossSession}
        onCommit={(commit) => commits.push(commit)}
      />,
    );
    expect(latestCommit(commits, "session-2-image-a.png")).toMatchObject({
      imageName: null,
      imageUrl: null,
      isLoading: true,
    });
    await expectImage("session-2-image-a.png", "blob:session-2-a-4");
    expect(revokeObjectURL.mock.calls.filter(([url]) => url === "blob:a-3")).toHaveLength(1);

    const replacementImageA = new Blob(["replacement-a"], { type: "image/png" });
    queryCache.set(queryIdentity("session-2", "image-a"), replacementImageA);
    rendered.rerender(
      <ViewerCommitProbe
        target={targetAcrossSession}
        onCommit={(commit) => commits.push(commit)}
      />,
    );
    expect(latestCommit(commits, "session-2-image-a.png")).toMatchObject({
      imageName: null,
      imageUrl: null,
      isLoading: true,
    });
    await expectImage("session-2-image-a.png", "blob:replacement-a-5");
    expect(
      revokeObjectURL.mock.calls.filter(([url]) => url === "blob:session-2-a-4"),
    ).toHaveLength(1);

    for (const commit of commits) {
      if (commit.imageName === "image-b.png") {
        expect(commit.imageUrl).not.toMatch(/^blob:a-/u);
      }
      if (commit.imageName === "image-a.png") {
        expect(commit.imageUrl).not.toMatch(/^blob:b-/u);
      }
    }

    rendered.unmount();
    for (const [url] of revokeObjectURL.mock.calls) {
      expect(revokeObjectURL.mock.calls.filter(([candidate]) => candidate === url)).toHaveLength(1);
    }
  });
});

function ViewerCommitProbe({
  target,
  onCommit,
}: {
  target: PromptAttachmentTarget;
  onCommit: (commit: ViewerCommit) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const image = rootRef.current?.querySelector("img") ?? null;
    onCommit({
      requestedName: target.name,
      imageName: image?.getAttribute("alt") ?? null,
      imageUrl: image?.getAttribute("src") ?? null,
      isLoading: rootRef.current?.textContent?.includes("Loading attachment preview…") ?? false,
    });
  });
  return (
    <div ref={rootRef}>
      <PromptAttachmentViewer target={target} />
    </div>
  );
}

function submittedImageTarget(
  sessionId: string,
  attachmentId: string,
  name: string,
): PromptAttachmentTarget {
  return promptAttachmentViewerTarget({
    origin: "session",
    sessionId,
    attachmentId,
    name,
    mimeType: "image/png",
    attachmentKind: "image",
    attachmentSource: "upload",
  }) as PromptAttachmentTarget;
}

function queryIdentity(
  sessionId: string | null,
  attachmentId: string | null,
): string {
  return JSON.stringify([sessionId, attachmentId]);
}

function latestCommit(commits: ViewerCommit[], requestedName: string): ViewerCommit {
  for (let index = commits.length - 1; index >= 0; index -= 1) {
    const commit = commits[index];
    if (commit?.requestedName === requestedName) {
      return commit;
    }
  }
  throw new Error(`Missing viewer commit for ${requestedName}`);
}

async function expectImage(name: string, src: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("img", { name }).getAttribute("src")).toBe(src);
  });
}
