/* @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerModelSelectorControl } from "#product/components/workspace/chat/input/ComposerModelSelectorControl";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";

/**
 * The trigger's `availability` contract: which sentence it may claim, and
 * which states may disable it. Split from ComposerModelSelectorControl.test
 * so neither file carries two unrelated concerns past the size cap.
 */

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

afterEach(cleanup);

function openModelOptions(container: HTMLElement) {
  const trigger = container.querySelector<HTMLElement>("[data-composer-model-trigger]")!;
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

function availabilityProps(overrides: Partial<ModelSelectorProps> = {}): ModelSelectorProps {
  return {
    connectionState: "healthy",
    currentModel: null,
    groups: [],
    hasAgents: true,
    isLoading: false,
    onSelect: vi.fn(),
    ...overrides,
  };
}

it("reads 'Select model' while an observation is pending, never 'No agents'", () => {
  // The first-run bug: agents are installing, so they exist and the catalog is
  // not loading. "No agents" would be false and "Loading agents..." would
  // misname the install.
  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({ availability: "observation_pending" })}
      />
    </MemoryRouter>,
  );

  const trigger = container.querySelector<HTMLButtonElement>("[data-composer-model-trigger]")!;
  expect(trigger.textContent).toContain("Select model");
  expect(trigger.textContent).not.toContain("No agents");
  expect(trigger.textContent).not.toContain("Loading agents");
  expect(trigger.disabled).toBe(true);
});

it("keeps 'Loading agents...' for a genuine catalog load and 'No agents' for an empty one", () => {
  const loading = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({ isLoading: true, hasAgents: false })}
      />
    </MemoryRouter>,
  );
  expect(
    loading.container.querySelector("[data-composer-model-trigger]")?.textContent,
  ).toContain("Loading agents...");
  cleanup();

  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({ hasAgents: false })}
      />
    </MemoryRouter>,
  );
  expect(
    container.querySelector("[data-composer-model-trigger]")?.textContent,
  ).toContain("No agents");
});

it("keeps the trigger enabled for observed_empty and disabled for a failed observation", () => {
  const empty = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({ availability: "observed_empty" })}
      />
    </MemoryRouter>,
  );
  const enabledTrigger = empty.container.querySelector<HTMLButtonElement>(
    "[data-composer-model-trigger]",
  )!;
  expect(enabledTrigger.disabled).toBe(false);
  expect(enabledTrigger.textContent).toContain("Select model");
  cleanup();

  // Ruling 2's other half at the DOM: `unavailable` is what the gate maps
  // agent_setup_required to, so an enabled "Select model" cannot appear beside
  // a "Finish agent setup" notice.
  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({ availability: "unavailable" })}
      />
    </MemoryRouter>,
  );
  expect(
    container.querySelector<HTMLButtonElement>("[data-composer-model-trigger]")!.disabled,
  ).toBe(true);
});

it("never says 'No agents' about a sandbox the gate already explained", () => {
  // The cloud shape: `hasAgents` is derived from an answer that carried zero
  // rows, so it can be false in exactly the states the gate has a truer story
  // for. "No agents" is a claim about the CATALOG, and beside a notice saying
  // the cloud has not reported yet it is the second of two contradictory
  // stories about the same sandbox.
  for (const availability of ["observed_empty", "unavailable"] as const) {
    const { container } = render(
      <MemoryRouter>
        <ComposerModelSelectorControl
          modelSelectorProps={availabilityProps({ hasAgents: false, availability })}
        />
      </MemoryRouter>,
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-composer-model-trigger]",
    )!;
    expect(trigger.textContent).not.toContain("No agents");
    expect(trigger.textContent).toContain("Select model");
    cleanup();
  }
});

it("keeps an observed_empty cloud picker openable once its agents are known", () => {
  // Ruling 3 depends on `hasAgents`, which is outside the gate: an
  // `observed_empty` sandbox whose agents were counted from its (empty) rows
  // produced a DISABLED picker, turning the one cure path into a dead end.
  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({
          hasAgents: true,
          availability: "observed_empty",
        })}
      />
    </MemoryRouter>,
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    "[data-composer-model-trigger]",
  )!;
  expect(trigger.disabled).toBe(false);
  openModelOptions(container);
  expect(document.body.textContent).toContain("Your agents reported no models yet.");
});

it("says the agents reported nothing in the observed_empty picker body", () => {
  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl
        modelSelectorProps={availabilityProps({ availability: "observed_empty" })}
      />
    </MemoryRouter>,
  );
  openModelOptions(container);

  expect(document.body.textContent).toContain("Your agents reported no models yet.");
  expect(document.body.textContent).not.toContain("No harnesses yet.");
  // The footer cures stay exactly as they are.
  expect(document.body.textContent).toContain("Add provider");
  expect(document.body.textContent).toContain("Settings");
});

it("keeps the no-harnesses copy when the catalog is genuinely empty", () => {
  const { container } = render(
    <MemoryRouter>
      <ComposerModelSelectorControl modelSelectorProps={availabilityProps()} />
    </MemoryRouter>,
  );
  openModelOptions(container);

  expect(document.body.textContent).toContain("No harnesses yet.");
  expect(document.body.textContent).not.toContain("Your agents reported no models yet.");
});

it("returns focus to the composer editor on Escape from the closed trigger", () => {
  const { container } = render(
    <MemoryRouter initialEntries={["/"]}>
      <div data-focus-zone="chat">
        <textarea data-chat-composer-editor defaultValue="Draft kept" />
        <ComposerModelSelectorControl
          modelSelectorProps={availabilityProps({ availability: "observed_empty" })}
          keyboardShortcutEnabled
        />
      </div>
    </MemoryRouter>,
  );

  const trigger = container.querySelector<HTMLButtonElement>("[data-composer-model-trigger]")!;
  trigger.focus();
  expect(document.activeElement).toBe(trigger);

  fireEvent.keyDown(trigger, { key: "Escape", code: "Escape" });

  const editor = container.querySelector<HTMLTextAreaElement>("[data-chat-composer-editor]")!;
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe("Draft kept");
});
