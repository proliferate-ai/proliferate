#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_PROFILE = "latency";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BUDGETS = {
  tabSwitchMs: 50,
  promptVisibleMs: 80,
  workspaceProjectedMs: 150,
};

function usage() {
  console.error(`Usage:
  node scripts/latency-benchmark.mjs [--profile latency] [--url http://127.0.0.1:1420]
    [--headed] [--save-storage-state] [--storage-state path] [--output path]
    [--bench tab-switch,prompt-submit,workspace-project]

Examples:
  make dev PROFILE=latency
  VITE_PROLIFERATE_DEBUG_LATENCY=1 node scripts/latency-benchmark.mjs --profile latency
  node scripts/latency-benchmark.mjs --profile latency --headed --save-storage-state
`);
}

function parseArgs(argv) {
  const args = {
    profile: process.env.PROFILE || DEFAULT_PROFILE,
    url: process.env.PROLIFERATE_WEB_URL || null,
    headed: false,
    saveStorageState: false,
    storageState: null,
    output: null,
    benches: ["tab-switch", "prompt-submit", "workspace-project"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    budgets: { ...DEFAULT_BUDGETS },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--profile") {
      args.profile = requireValue(argv, ++index, arg);
    } else if (arg === "--url") {
      args.url = requireValue(argv, ++index, arg);
    } else if (arg === "--headed") {
      args.headed = true;
    } else if (arg === "--save-storage-state") {
      args.saveStorageState = true;
    } else if (arg === "--storage-state") {
      args.storageState = requireValue(argv, ++index, arg);
    } else if (arg === "--output") {
      args.output = requireValue(argv, ++index, arg);
    } else if (arg === "--bench") {
      args.benches = requireValue(argv, ++index, arg)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(requireValue(argv, ++index, arg));
    } else if (arg === "--budget-tab-switch-ms") {
      args.budgets.tabSwitchMs = Number(requireValue(argv, ++index, arg));
    } else if (arg === "--budget-prompt-visible-ms") {
      args.budgets.promptVisibleMs = Number(requireValue(argv, ++index, arg));
    } else if (arg === "--budget-workspace-projected-ms") {
      args.budgets.workspaceProjectedMs = Number(requireValue(argv, ++index, arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const env = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/u);
    if (!match) {
      continue;
    }
    env[match[1]] = unquoteShellValue(match[2]);
  }
  return env;
}

function unquoteShellValue(raw) {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("'\\''", "'");
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replaceAll("\\\"", "\"");
  }
  return value;
}

function profilePaths(profile) {
  const root = path.join(homedir(), ".proliferate-local", "dev", "profiles", profile);
  return {
    root,
    launchEnv: path.join(root, "launch.env"),
    storageState: path.join(root, "playwright-storage.json"),
  };
}

function resolveUrl(args) {
  if (args.url) {
    return args.url;
  }
  const paths = profilePaths(args.profile);
  const env = readEnvFile(paths.launchEnv);
  const port = env.PROLIFERATE_WEB_PORT || process.env.PROLIFERATE_WEB_PORT || "1420";
  return `http://127.0.0.1:${port}`;
}

function defaultOutputPath(profile) {
  const dir = path.join(homedir(), "latency");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `playwright-benchmark-${profile}.json`);
}

async function firstVisible(page, selectors, timeoutMs) {
  const locators = selectors.map((selector) => page.locator(selector).first());
  await Promise.any(locators.map((locator) => locator.waitFor({ state: "visible", timeout: timeoutMs })));
  for (const locator of locators) {
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function waitForAppReady(page, timeoutMs) {
  return firstVisible(page, [
    "[data-chat-composer-editor]",
    "[data-home-composer-editor]",
    "[role='tablist'][aria-label='Chat tabs']",
    "textarea[placeholder='Describe a task']",
  ], timeoutMs);
}

async function ensureWorkspaceShell(page, timeoutMs) {
  if (await page.locator("[data-chat-composer-editor]").first().isVisible().catch(() => false)) {
    return true;
  }

  const workspaceRow = await firstVisible(page, [
    "[data-sidebar-workspace-item][data-sidebar-workspace-variant='local']",
    "[data-sidebar-workspace-item][data-sidebar-workspace-variant='worktree']",
    "[data-sidebar-workspace-item]",
  ], timeoutMs).catch(() => null);
  if (!workspaceRow) {
    return false;
  }

  await workspaceRow.evaluate((node) => node.click());
  return firstVisible(page, [
    "[data-chat-composer-editor]",
    "[role='tablist'][aria-label='Chat tabs']",
  ], timeoutMs).then(Boolean).catch(() => false);
}

async function countVisible(page, selector) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.filter((node) => {
      const element = node;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    }).length
  );
}

async function armVisibleTextProbe(page, key, selector, text) {
  await page.evaluate(({ key, selector, text }) => {
    window.__proliferateLatencyProbes ??= {};
    window.__proliferateLatencyProbeObservers ??= {};
    window.__proliferateLatencyProbeObservers[key]?.disconnect?.();
    const probe = {
      selector,
      text,
      armedAt: performance.now(),
      seenAt: null,
    };
    window.__proliferateLatencyProbes[key] = probe;
    const isVisible = (node) => {
      const element = node;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    };
    const check = () => {
      if (probe.seenAt !== null) {
        return;
      }
      const match = Array.from(document.querySelectorAll(selector))
        .find((node) => isVisible(node) && (node.textContent || "").includes(text));
      if (match) {
        probe.seenAt = performance.now();
      }
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
    window.__proliferateLatencyProbeObservers[key] = observer;
  }, { key, selector, text });
}

async function readVisibleTextProbe(page, key) {
  return page.evaluate((key) => {
    const probe = window.__proliferateLatencyProbes?.[key] ?? null;
    if (!probe) {
      return null;
    }
    return {
      armedAt: probe.armedAt,
      seenAt: probe.seenAt,
    };
  }, key);
}

async function waitForBrowserConsoleEvent(page, markerMs, textIncludes, timeoutMs) {
  const found = await page.waitForFunction(
    ({ markerMs, textIncludes }) =>
      window.__proliferateLatencyConsoleEvents?.some((event) =>
        event.at >= markerMs && event.text.includes(textIncludes)
      ) ?? false,
    { markerMs, textIncludes },
    { timeout: timeoutMs },
  ).then(() => true).catch(() => false);
  if (!found) {
    return null;
  }
  return page.evaluate(({ markerMs, textIncludes }) =>
    window.__proliferateLatencyConsoleEvents
      ?.filter((event) => event.at >= markerMs && event.text.includes(textIncludes))
      .sort((a, b) => a.at - b.at)[0] ?? null,
  { markerMs, textIncludes });
}

async function getSelectedTabLabel(page) {
  const activeTab = page.locator("[data-chat-tab][data-chat-tab-active='true']").first();
  if (await activeTab.isVisible().catch(() => false)) {
    const id = await activeTab.getAttribute("data-chat-tab-id").catch(() => null);
    if (id) {
      return id;
    }
  }

  const selected = page.locator("[role='tablist'][aria-label='Chat tabs'] [role='tab'][aria-selected='true']").first();
  if (!await selected.isVisible().catch(() => false)) {
    return null;
  }
  return normalizeText(await selected.innerText().catch(() => ""));
}

async function countChatTabs(page) {
  const explicit = await countVisible(page, "[data-chat-tab]");
  return explicit > 0
    ? explicit
    : countVisible(page, "[role='tablist'][aria-label='Chat tabs'] [role='tab']");
}

async function ensureTwoChatTabs(page, timeoutMs) {
  if (!await ensureWorkspaceShell(page, timeoutMs)) {
    return false;
  }

  for (let attempt = 0; attempt < 2 && await countChatTabs(page) < 2; attempt += 1) {
    const explicitNewChat = page.locator("[data-chat-new-tab-button], button[title='New chat']").first();
    if (await explicitNewChat.isVisible().catch(() => false)) {
      await explicitNewChat.click();
      await page.waitForTimeout(50);
    }
  }

  await page.waitForFunction(() =>
    Array.from(
      document.querySelectorAll(
        document.querySelector("[data-chat-tab]")
          ? "[data-chat-tab]"
          : "[role='tablist'][aria-label='Chat tabs'] [role='tab']",
      ),
    ).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length >= 2,
  null, { timeout: timeoutMs }).catch(() => {});

  return (await countChatTabs(page)) >= 2;
}

async function ensureActiveChatTab(page) {
  if (await getSelectedTabLabel(page)) {
    return true;
  }
  const clicked = await page.evaluate(() => {
    const isVisible = (node) => {
      const element = node;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden";
    };
    const tab = Array.from(document.querySelectorAll(
      "[data-chat-tab], [role='tablist'][aria-label='Chat tabs'] [role='tab']",
    )).find(isVisible);
    tab?.click();
    return Boolean(tab);
  });
  if (!clicked) {
    return false;
  }
  await page.waitForFunction(() =>
    !!document.querySelector("[data-chat-tab][data-chat-tab-active='true']")
    || !!document.querySelector("[role='tablist'][aria-label='Chat tabs'] [role='tab'][aria-selected='true']"),
  null, { timeout: 2_000 }).catch(() => {});
  return Boolean(await getSelectedTabLabel(page));
}

async function benchmarkTabSwitch(page, args) {
  const available = await ensureTwoChatTabs(page, args.timeoutMs);
  if (!available) {
    return skipped("tab-switch", "Need at least two visible chat tabs.");
  }

  await ensureActiveChatTab(page);
  const before = await getSelectedTabLabel(page);
  if (!before) {
    return skipped("tab-switch", "No active chat tab is available after workspace setup.");
  }
  const startedAt = await page.evaluate(() => performance.now());
  await page.keyboard.press("Meta+Alt+ArrowRight");
  const changed = await page.waitForFunction((previous) => {
    const selectedTab = document.querySelector("[data-chat-tab][data-chat-tab-active='true']");
    const label = selectedTab?.getAttribute("data-chat-tab-id")
      || document.querySelector("[role='tablist'][aria-label='Chat tabs'] [role='tab'][aria-selected='true']")
        ?.textContent
        ?.replace(/\s+/gu, " ")
        .trim()
      || null;
    return !!label && label !== previous;
  }, before, { timeout: args.timeoutMs }).catch(() => false);
  const finishedAt = await page.evaluate(() => performance.now());
  const durationMs = Math.round(finishedAt - startedAt);
  const loadingHeroVisible = await countVisible(page, "[data-chat-loading-hero]");

  return {
    name: "tab-switch",
    ok: Boolean(changed) && durationMs <= args.budgets.tabSwitchMs && loadingHeroVisible === 0,
    durationMs,
    budgetMs: args.budgets.tabSwitchMs,
    before,
    after: await getSelectedTabLabel(page),
    loadingHeroVisible,
  };
}

async function benchmarkPromptSubmit(page, args) {
  const editor = await firstVisible(page, [
    "[data-chat-composer-editor]",
    "[data-home-composer-editor]",
    "textarea[placeholder='Describe a task']",
  ], args.timeoutMs);
  if (!editor) {
    return skipped("prompt-submit", "No composer editor is visible.");
  }

  const promptText = `latency probe ${Date.now()}`;
  await editor.click();
  await editor.fill(promptText);

  const sendButton = page.locator("[data-chat-send-button]:visible").last();
  if (!await sendButton.isVisible().catch(() => false)) {
    return skipped("prompt-submit", "No visible send button.");
  }

  const probeKey = `prompt-submit-${Date.now()}`;
  await armVisibleTextProbe(page, probeKey, "[data-chat-user-message]", promptText);
  const startedAt = await page.evaluate(() => performance.now());
  await sendButton.click();
  const appeared = await page.waitForFunction(
    (key) => window.__proliferateLatencyProbes?.[key]?.seenAt !== null,
    probeKey,
    { timeout: args.timeoutMs },
  )
    .then(() => true)
    .catch(() => false);
  const probe = await readVisibleTextProbe(page, probeKey);
  const finishedAt = await page.evaluate(() => performance.now());
  const durationMs = appeared && probe?.seenAt
    ? Math.round(probe.seenAt - startedAt)
    : Math.round(finishedAt - startedAt);
  const sendButtons = await countVisible(page, "[data-chat-send-button]");
  const stopButtons = await countVisible(page, "[data-chat-stop-button]");
  const loadingHeroVisible = await countVisible(page, "[data-chat-loading-hero]");
  const cancelButtonVisible = await countVisible(page, "button:has-text('Cancel')");

  return {
    name: "prompt-submit",
    ok: appeared
      && durationMs <= args.budgets.promptVisibleMs
      && loadingHeroVisible === 0
      && cancelButtonVisible === 0,
    durationMs,
    budgetMs: args.budgets.promptVisibleMs,
    appeared,
    sendButtons,
    stopButtons,
    loadingHeroVisible,
    cancelButtonVisible,
  };
}

async function benchmarkWorkspaceProject(page, args) {
  if (!await ensureWorkspaceShell(page, args.timeoutMs)) {
    return skipped("workspace-project", "No workspace row could be selected.");
  }

  const before = await countVisible(page, "[data-chat-composer-editor]");
  const startedAt = await page.evaluate(() => performance.now());
  await page.keyboard.press("Meta+N");
  const pendingShellEvent = await waitForBrowserConsoleEvent(
    page,
    startedAt,
    "workspace.entry.pending_shell",
    args.timeoutMs,
  );
  const projected = pendingShellEvent
    ? await firstVisible(page, [
      "[data-chat-composer-editor]",
      "[role='tab'][aria-selected='true']",
    ], args.timeoutMs).then(Boolean).catch(() => false)
    : false;
  const finishedAt = await page.evaluate(() => performance.now());
  const durationMs = pendingShellEvent
    ? Math.round(pendingShellEvent.at - startedAt)
    : Math.round(finishedAt - startedAt);
  const loadingHeroVisible = await countVisible(page, "[data-chat-loading-hero]");
  const composerVisible = await countVisible(page, "[data-chat-composer-editor]");

  return {
    name: "workspace-project",
    ok: pendingShellEvent !== null
      && projected
      && durationMs <= args.budgets.workspaceProjectedMs
      && loadingHeroVisible === 0
      && composerVisible > 0,
    durationMs,
    budgetMs: args.budgets.workspaceProjectedMs,
    pendingShellEventSeen: pendingShellEvent !== null,
    measuredBy: "workspace.entry.pending_shell",
    composerBefore: before,
    composerVisible,
    loadingHeroVisible,
  };
}

function skipped(name, reason) {
  return {
    name,
    ok: false,
    skipped: true,
    reason,
  };
}

function normalizeText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function parseConsolePayload(text) {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(jsonStart));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = args.profile;
  const paths = profilePaths(profile);
  const url = resolveUrl(args);
  const storageStatePath = args.storageState ?? paths.storageState;
  const outputPath = args.output ?? defaultOutputPath(profile);
  const consoleEvents = [];
  const measurementSummaries = [];
  const latencyEvents = [];

  const browser = await chromium.launch({
    headless: !args.headed,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__proliferateLatencyConsoleEvents = [];
    for (const method of ["debug", "info", "log", "warn", "error"]) {
      const original = console[method]?.bind(console);
      if (!original) {
        continue;
      }
      console[method] = (...args) => {
        const text = args.map((arg) => {
          if (typeof arg === "string") {
            return arg;
          }
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }).join(" ");
        window.__proliferateLatencyConsoleEvents.push({
          at: performance.now(),
          method,
          text,
        });
        original(...args);
      };
    }
  });
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[workspace-latency]")) {
      const payload = parseConsolePayload(text);
      latencyEvents.push({ type: message.type(), text, payload });
    }
    if (text.includes("[measurement_summary_json]")) {
      const payload = parseConsolePayload(text);
      measurementSummaries.push(payload ?? { raw: text });
    }
    if (
      text.includes("[workspace-latency]")
      || text.includes("[measurement_summary_json]")
      || text.includes("[debug-measurement]")
    ) {
      consoleEvents.push({ type: message.type(), text });
    }
  });

  const results = {
    profile,
    url,
    startedAt: new Date().toISOString(),
    budgets: args.budgets,
    benches: [],
    consoleEvents,
    latencyEvents,
    measurementSummaries,
    ok: false,
  };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: args.timeoutMs });
    const ready = await waitForAppReady(page, args.timeoutMs).then(Boolean).catch(() => false);
    if (!ready) {
      results.error = `App did not reach a benchmarkable surface at ${url}. If auth is blocking, run with --headed --save-storage-state once.`;
    } else {
      for (const bench of args.benches) {
        if (bench === "tab-switch") {
          results.benches.push(await benchmarkTabSwitch(page, args));
        } else if (bench === "prompt-submit") {
          results.benches.push(await benchmarkPromptSubmit(page, args));
        } else if (bench === "workspace-project") {
          results.benches.push(await benchmarkWorkspaceProject(page, args));
        } else {
          results.benches.push(skipped(bench, `Unknown benchmark '${bench}'.`));
        }
      }
    }
    results.ok = results.benches.length > 0 && results.benches.every((bench) => bench.ok);
    if (args.saveStorageState) {
      mkdirSync(path.dirname(storageStatePath), { recursive: true });
      await context.storageState({ path: storageStatePath });
      results.storageStatePath = storageStatePath;
    }
  } finally {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
