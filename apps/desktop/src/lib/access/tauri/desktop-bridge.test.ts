import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeInfo: vi.fn(),
  restartRuntime: vi.fn(),
  listConfiguredEnvVarNames: vi.fn(),
  setEnvVarSecret: vi.fn(),
  deleteEnvVarSecret: vi.fn(),
  pickFolder: vi.fn(),
  getHomeDir: vi.fn(),
  pathIsDirectory: vi.fn(),
  listAvailableEditors: vi.fn(),
  listOpenTargets: vi.fn(),
  openTarget: vi.fn(),
  revealInFinder: vi.fn(),
  openInTerminal: vi.fn(),
  showNativeContextMenu: vi.fn(),
  listenForShortcutMenuEvents: vi.fn(),
  setRunningAgentCount: vi.fn(),
  setWebviewZoom: vi.fn(),
  setWorkspaceActivityIndicator: vi.fn(),
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  getAppVersion: vi.fn(),
  isTauriPackaged: vi.fn(),
  relaunch: vi.fn(),
  getDesktopInstallId: vi.fn(),
  ensureDesktopDispatchWorker: vi.fn(),
  stopDesktopDispatchWorker: vi.fn(),
  getSshDirectTargetProfile: vi.fn(),
  setSshDirectTargetProfile: vi.fn(),
  deleteSshDirectTargetProfile: vi.fn(),
  ensureSshAnyHarnessTunnel: vi.fn(),
  readWorkspaceScratchPad: vi.fn(),
  writeWorkspaceScratchPad: vi.fn(),
  logRendererEvent: vi.fn(),
  collectSupportDiagnostics: vi.fn(),
  saveDiagnosticJson: vi.fn(),
  stageSupportReportAttachment: vi.fn(),
  readStagedSupportReportAttachment: vi.fn(),
  deleteStagedSupportReportAttachment: vi.fn(),
}));

vi.mock("@/lib/access/tauri/runtime", () => ({
  getRuntimeInfo: mocks.getRuntimeInfo,
}));
vi.mock("@/lib/access/tauri/credentials", () => ({
  listConfiguredEnvVarNames: mocks.listConfiguredEnvVarNames,
  setEnvVarSecret: mocks.setEnvVarSecret,
  deleteEnvVarSecret: mocks.deleteEnvVarSecret,
  restartRuntime: mocks.restartRuntime,
}));
vi.mock("@/lib/access/tauri/shell", () => ({
  pickFolder: mocks.pickFolder,
  getHomeDir: mocks.getHomeDir,
  pathIsDirectory: mocks.pathIsDirectory,
  listAvailableEditors: mocks.listAvailableEditors,
  listOpenTargets: mocks.listOpenTargets,
  openTarget: mocks.openTarget,
  revealInFinder: mocks.revealInFinder,
  openInTerminal: mocks.openInTerminal,
}));
vi.mock("@/lib/access/tauri/context-menu", () => ({
  showNativeContextMenu: mocks.showNativeContextMenu,
}));
vi.mock("@/lib/access/tauri/menu", () => ({
  listenForShortcutMenuEvents: mocks.listenForShortcutMenuEvents,
}));
vi.mock("@/lib/access/tauri/window", () => ({
  setRunningAgentCount: mocks.setRunningAgentCount,
  setWebviewZoom: mocks.setWebviewZoom,
}));
vi.mock("@/lib/access/tauri/dock", () => ({
  setWorkspaceActivityIndicator: mocks.setWorkspaceActivityIndicator,
}));
vi.mock("@/lib/access/tauri/updater", () => ({
  checkForUpdate: mocks.checkForUpdate,
  downloadAndInstall: mocks.downloadAndInstall,
  getAppVersion: mocks.getAppVersion,
  isTauriPackaged: mocks.isTauriPackaged,
  relaunch: mocks.relaunch,
}));
vi.mock("@/lib/access/tauri/desktop-install-id", () => ({
  getDesktopInstallId: mocks.getDesktopInstallId,
}));
vi.mock("@/lib/access/tauri/cloud-worker", () => ({
  ensureDesktopDispatchWorker: mocks.ensureDesktopDispatchWorker,
  stopDesktopDispatchWorker: mocks.stopDesktopDispatchWorker,
}));
vi.mock("@/lib/access/tauri/ssh-target-profile", () => ({
  getSshDirectTargetProfile: mocks.getSshDirectTargetProfile,
  setSshDirectTargetProfile: mocks.setSshDirectTargetProfile,
  deleteSshDirectTargetProfile: mocks.deleteSshDirectTargetProfile,
}));
vi.mock("@/lib/access/tauri/ssh-tunnel", () => ({
  ensureSshAnyHarnessTunnel: mocks.ensureSshAnyHarnessTunnel,
}));
vi.mock("@/lib/access/tauri/workspace-scratch", () => ({
  readWorkspaceScratchPad: mocks.readWorkspaceScratchPad,
  writeWorkspaceScratchPad: mocks.writeWorkspaceScratchPad,
}));
vi.mock("@/lib/access/tauri/diagnostics", () => ({
  logRendererEvent: mocks.logRendererEvent,
  collectSupportDiagnostics: mocks.collectSupportDiagnostics,
  saveDiagnosticJson: mocks.saveDiagnosticJson,
}));
vi.mock("@/lib/access/tauri/support", () => ({
  stageSupportReportAttachment: mocks.stageSupportReportAttachment,
  readStagedSupportReportAttachment: mocks.readStagedSupportReportAttachment,
  deleteStagedSupportReportAttachment: mocks.deleteStagedSupportReportAttachment,
}));

import { desktopBridge } from "@/lib/access/tauri/desktop-bridge";

/** Flush pending microtasks so `.then(...)` registration callbacks run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("desktopBridge identity", () => {
  it("is a stable module-level constant", async () => {
    const again = (await import("@/lib/access/tauri/desktop-bridge")).desktopBridge;
    expect(again).toBe(desktopBridge);
  });
});

describe("runtime", () => {
  it("maps RuntimeInfo.url to a runtime connection without an auth token", async () => {
    mocks.getRuntimeInfo.mockResolvedValue({
      url: "http://127.0.0.1:8457",
      port: 8457,
      status: "healthy",
    });

    const connection = await desktopBridge.runtime.getConnection();

    expect(mocks.getRuntimeInfo).toHaveBeenCalledTimes(1);
    expect(connection).toEqual({ runtimeUrl: "http://127.0.0.1:8457" });
    expect(connection).not.toHaveProperty("authToken");
  });

  it("maps the restarted runtime url the same way", async () => {
    mocks.restartRuntime.mockResolvedValue({
      url: "http://127.0.0.1:9000",
      port: 9000,
      status: "starting",
    });

    const connection = await desktopBridge.runtime.restart();

    expect(mocks.restartRuntime).toHaveBeenCalledTimes(1);
    expect(connection).toEqual({ runtimeUrl: "http://127.0.0.1:9000" });
  });
});

describe("files", () => {
  it("delegates renamed methods to the shell wrappers", async () => {
    mocks.pickFolder.mockResolvedValue("/repo");
    mocks.getHomeDir.mockResolvedValue("/home/dev");
    mocks.pathIsDirectory.mockResolvedValue(true);
    mocks.revealInFinder.mockResolvedValue(undefined);
    mocks.openInTerminal.mockResolvedValue(undefined);

    await expect(desktopBridge.files.pickDirectory()).resolves.toBe("/repo");
    await expect(desktopBridge.files.getHomeDirectory()).resolves.toBe("/home/dev");
    await expect(desktopBridge.files.isDirectory("/repo")).resolves.toBe(true);
    expect(mocks.pathIsDirectory).toHaveBeenCalledWith("/repo");

    await desktopBridge.files.reveal("/repo");
    expect(mocks.revealInFinder).toHaveBeenCalledWith("/repo");

    await desktopBridge.files.openTerminal("/repo");
    expect(mocks.openInTerminal).toHaveBeenCalledWith("/repo");
  });

  it("passes editor/open-target methods through unchanged", async () => {
    mocks.listAvailableEditors.mockResolvedValue([]);
    mocks.listOpenTargets.mockResolvedValue([]);
    mocks.openTarget.mockResolvedValue(undefined);

    await desktopBridge.files.listAvailableEditors();
    expect(mocks.listAvailableEditors).toHaveBeenCalledTimes(1);

    await desktopBridge.files.listOpenTargets("directory");
    expect(mocks.listOpenTargets).toHaveBeenCalledWith("directory");

    await desktopBridge.files.openTarget("cursor", "/repo");
    expect(mocks.openTarget).toHaveBeenCalledWith("cursor", "/repo");
  });
});

describe("localCredentials", () => {
  it("delegates list/set/remove to the credentials wrappers", async () => {
    mocks.listConfiguredEnvVarNames.mockResolvedValue(["OPENAI_API_KEY"]);
    mocks.setEnvVarSecret.mockResolvedValue(undefined);
    mocks.deleteEnvVarSecret.mockResolvedValue(undefined);

    await expect(desktopBridge.localCredentials.listConfigured()).resolves.toEqual([
      "OPENAI_API_KEY",
    ]);

    await desktopBridge.localCredentials.set("OPENAI_API_KEY", "sk-1");
    expect(mocks.setEnvVarSecret).toHaveBeenCalledWith("OPENAI_API_KEY", "sk-1");

    await desktopBridge.localCredentials.remove("OPENAI_API_KEY");
    expect(mocks.deleteEnvVarSecret).toHaveBeenCalledWith("OPENAI_API_KEY");
  });
});

describe("nativeUi", () => {
  it("passes context-menu items and position through", async () => {
    mocks.showNativeContextMenu.mockResolvedValue(true);
    const items = [{ id: "copy", label: "Copy" }];
    const position = { x: 10, y: 20 };

    await expect(
      desktopBridge.nativeUi.showContextMenu(items, position),
    ).resolves.toBe(true);
    expect(mocks.showNativeContextMenu).toHaveBeenCalledWith(items, position);
  });

  it("delegates state setters to the window/dock wrappers", async () => {
    mocks.setRunningAgentCount.mockResolvedValue(undefined);
    mocks.setWorkspaceActivityIndicator.mockResolvedValue(undefined);
    mocks.setWebviewZoom.mockResolvedValue(undefined);

    await desktopBridge.nativeUi.setRunningAgentCount(3);
    expect(mocks.setRunningAgentCount).toHaveBeenCalledWith(3);

    await desktopBridge.nativeUi.setWorkspaceActivity({
      state: "attention",
      attentionCount: 2,
    });
    expect(mocks.setWorkspaceActivityIndicator).toHaveBeenCalledWith({
      state: "attention",
      attentionCount: 2,
    });

    await desktopBridge.nativeUi.setZoom(1.25);
    expect(mocks.setWebviewZoom).toHaveBeenCalledWith(1.25);
  });

  it("delivers menu commands to an active subscriber", async () => {
    let captured: ((id: string) => void) | undefined;
    const unlisten = vi.fn();
    mocks.listenForShortcutMenuEvents.mockImplementation((handler) => {
      captured = handler;
      return Promise.resolve(unlisten);
    });

    const listener = vi.fn();
    const unsubscribe = desktopBridge.nativeUi.subscribeMenuCommands(listener);
    await flushMicrotasks();

    captured?.("workspace.new");
    expect(listener).toHaveBeenCalledWith("workspace.new");

    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("is race-safe when unsubscribed before registration resolves", async () => {
    let resolveRegistration: ((fn: () => void) => void) | undefined;
    let captured: ((id: string) => void) | undefined;
    const registration = new Promise<() => void>((resolve) => {
      resolveRegistration = resolve;
    });
    mocks.listenForShortcutMenuEvents.mockImplementation((handler) => {
      captured = handler;
      return registration;
    });

    const listener = vi.fn();
    const unsubscribe = desktopBridge.nativeUi.subscribeMenuCommands(listener);

    // Unsubscribe before native registration has resolved.
    unsubscribe();

    const unlisten = vi.fn();
    resolveRegistration?.(unlisten);
    await flushMicrotasks();

    // The eventual unlisten is invoked...
    expect(unlisten).toHaveBeenCalledTimes(1);

    // ...and no command is ever delivered, even if one slips in.
    captured?.("workspace.new");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("updater", () => {
  it("reports support synchronously from isTauriPackaged", () => {
    mocks.isTauriPackaged.mockReturnValue(true);
    expect(desktopBridge.updater.isSupported()).toBe(true);
    expect(mocks.isTauriPackaged).toHaveBeenCalledTimes(1);
  });

  it("maps a current check to null", async () => {
    mocks.checkForUpdate.mockResolvedValue({ kind: "current" });
    await expect(desktopBridge.updater.check()).resolves.toBeNull();
  });

  it("maps an available check to a DesktopUpdate carrying the native handle", async () => {
    const handle = { downloadAndInstall: vi.fn() };
    mocks.checkForUpdate.mockResolvedValue({
      kind: "available",
      version: "0.4.0",
      title: "Notes",
      update: handle,
    });

    await expect(desktopBridge.updater.check()).resolves.toEqual({
      version: "0.4.0",
      title: "Notes",
      handle,
    });
  });

  it("rejects an error check instead of reporting no update", async () => {
    mocks.checkForUpdate.mockResolvedValue({
      kind: "error",
      message: "network down",
    });

    await expect(desktopBridge.updater.check()).rejects.toThrow("network down");
  });

  it("accumulates chunk lengths into a bounded 0..1 fraction", async () => {
    mocks.downloadAndInstall.mockImplementation(async (_handle, cb) => {
      cb?.(50, 100);
      cb?.(50, 100);
      cb?.(50, 100); // overshoot -> clamped to 1
    });

    const fractions: number[] = [];
    await desktopBridge.updater.downloadAndInstall(
      { version: "0.4.0", title: null, handle: { id: 1 } },
      (fraction) => fractions.push(fraction),
    );

    expect(mocks.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(mocks.downloadAndInstall.mock.calls[0][0]).toEqual({ id: 1 });
    expect(fractions).toEqual([0.5, 1, 1]);
  });

  it("does not call onProgress while total length is unknown", async () => {
    mocks.downloadAndInstall.mockImplementation(async (_handle, cb) => {
      cb?.(50, undefined);
      cb?.(50, undefined);
    });

    const onProgress = vi.fn();
    await desktopBridge.updater.downloadAndInstall(
      { version: "0.4.0", title: null, handle: {} },
      onProgress,
    );

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("delegates getVersion and relaunch", async () => {
    mocks.getAppVersion.mockResolvedValue("0.4.0");
    mocks.relaunch.mockResolvedValue(undefined);

    await expect(desktopBridge.updater.getVersion()).resolves.toBe("0.4.0");
    await desktopBridge.updater.relaunch();
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  });
});

describe("worker", () => {
  it("preserves the ensure result", async () => {
    const status = { targetId: "t1", status: "started", configPath: "/cfg" };
    mocks.ensureDesktopDispatchWorker.mockResolvedValue(status);

    await expect(
      desktopBridge.worker.ensure({ targetId: "t1", enrollmentToken: "tok" }),
    ).resolves.toEqual(status);
    expect(mocks.ensureDesktopDispatchWorker).toHaveBeenCalledWith({
      targetId: "t1",
      enrollmentToken: "tok",
    });
  });

  it("discards the stop result and resolves undefined", async () => {
    mocks.stopDesktopDispatchWorker.mockResolvedValue({ stopped: true });

    await expect(desktopBridge.worker.stop()).resolves.toBeUndefined();
    expect(mocks.stopDesktopDispatchWorker).toHaveBeenCalledTimes(1);
  });

  it("delegates getInstallId", async () => {
    mocks.getDesktopInstallId.mockResolvedValue("install-1");
    await expect(desktopBridge.worker.getInstallId()).resolves.toBe("install-1");
  });
});

describe("ssh", () => {
  it("passes profile CRUD through", async () => {
    const profile = {
      targetId: "t1",
      sshHost: "host",
      sshUser: "user",
      sshPort: 22,
      identityFile: null,
      remoteAnyHarnessPort: 8457,
      workspaceRoot: null,
    };
    mocks.getSshDirectTargetProfile.mockResolvedValue(profile);
    mocks.setSshDirectTargetProfile.mockResolvedValue(undefined);
    mocks.deleteSshDirectTargetProfile.mockResolvedValue(undefined);

    await expect(desktopBridge.ssh.getProfile("t1")).resolves.toEqual(profile);
    expect(mocks.getSshDirectTargetProfile).toHaveBeenCalledWith("t1");

    await desktopBridge.ssh.saveProfile(profile);
    expect(mocks.setSshDirectTargetProfile).toHaveBeenCalledWith(profile);

    await desktopBridge.ssh.removeProfile("t1");
    expect(mocks.deleteSshDirectTargetProfile).toHaveBeenCalledWith("t1");
  });

  it("maps the tunnel localUrl to a runtime connection", async () => {
    mocks.ensureSshAnyHarnessTunnel.mockResolvedValue({
      localUrl: "http://127.0.0.1:5555",
      localPort: 5555,
    });

    const connection = await desktopBridge.ssh.ensureTunnel({
      targetId: "t1",
      sshHost: "host",
      sshUser: "user",
      sshPort: 22,
      identityFile: "/id",
      remoteAnyHarnessPort: 8457,
      workspaceRoot: "/root",
    });

    expect(connection).toEqual({ runtimeUrl: "http://127.0.0.1:5555" });
    expect(mocks.ensureSshAnyHarnessTunnel).toHaveBeenCalledWith({
      targetId: "t1",
      sshHost: "host",
      sshUser: "user",
      sshPort: 22,
      identityFile: "/id",
      remoteAnyHarnessPort: 8457,
    });
  });
});

describe("scratch", () => {
  it("delegates read/write with renamed methods", async () => {
    mocks.readWorkspaceScratchPad.mockResolvedValue({
      content: "note",
      updatedAtMs: 123,
    });
    mocks.writeWorkspaceScratchPad.mockResolvedValue({ updatedAtMs: 456 });

    await expect(desktopBridge.scratch.read("ws-1")).resolves.toEqual({
      content: "note",
      updatedAtMs: 123,
    });
    expect(mocks.readWorkspaceScratchPad).toHaveBeenCalledWith("ws-1");

    await expect(desktopBridge.scratch.write("ws-1", "next")).resolves.toEqual({
      updatedAtMs: 456,
    });
    expect(mocks.writeWorkspaceScratchPad).toHaveBeenCalledWith("ws-1", "next");
  });
});

describe("diagnostics", () => {
  it("delegates logEvent and collectSupportBundle", async () => {
    mocks.logRendererEvent.mockResolvedValue(undefined);
    mocks.collectSupportDiagnostics.mockResolvedValue(null);

    const payload = { source: "renderer", message: "boot" };
    await desktopBridge.diagnostics.logEvent(payload);
    expect(mocks.logRendererEvent).toHaveBeenCalledWith(payload);

    await expect(desktopBridge.diagnostics.collectSupportBundle()).resolves.toBeNull();
  });

  it("maps saveJson object input to positional arguments", async () => {
    mocks.saveDiagnosticJson.mockResolvedValue("/out.json");

    await expect(
      desktopBridge.diagnostics.saveJson({
        suggestedFileName: "bundle.json",
        contents: "{}",
      }),
    ).resolves.toBe("/out.json");
    expect(mocks.saveDiagnosticJson).toHaveBeenCalledWith("bundle.json", "{}");
  });

  it("passes attachment operations through", async () => {
    mocks.stageSupportReportAttachment.mockResolvedValue("/staged");
    mocks.readStagedSupportReportAttachment.mockResolvedValue("base64");
    mocks.deleteStagedSupportReportAttachment.mockResolvedValue(undefined);

    const input = { clientFileId: "c1", fileName: "a.png", dataBase64: "b64" };
    await expect(desktopBridge.diagnostics.stageAttachment(input)).resolves.toBe(
      "/staged",
    );
    expect(mocks.stageSupportReportAttachment).toHaveBeenCalledWith(input);

    await expect(
      desktopBridge.diagnostics.readAttachment("/staged"),
    ).resolves.toBe("base64");
    expect(mocks.readStagedSupportReportAttachment).toHaveBeenCalledWith("/staged");

    await desktopBridge.diagnostics.deleteAttachment("/staged");
    expect(mocks.deleteStagedSupportReportAttachment).toHaveBeenCalledWith("/staged");
  });
});
