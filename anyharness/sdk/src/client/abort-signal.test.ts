import { afterEach, describe, expect, it, vi } from "vitest";

const originalProcessDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "process",
);
const realProcess = globalThis.process;

describe.sequential("AbortSignal platform validation", () => {
  afterEach(() => {
    restoreProcess();
    vi.resetModules();
  });

  it("supports Node when ambient process has no getBuiltinModule", async () => {
    const shim = processShim({ getBuiltinModule: undefined });
    replaceProcess(shim);
    vi.resetModules();
    const { isNativeAbortSignal } = await import("./abort-signal.js");
    const controller = new AbortController();
    const trap = vi.fn();

    await expect(isNativeAbortSignal(controller.signal)).resolves.toBe(true);
    await expect(isNativeAbortSignal(proxySignal(controller.signal, trap)))
      .resolves.toBe(false);

    expect(trap).not.toHaveBeenCalled();
  });

  it("does not expose a caller signal to an ambient process detector", async () => {
    const ambientDetector = vi.fn((value: object) => {
      Reflect.getPrototypeOf(value);
      return false;
    });
    const getBuiltinModule = vi.fn(() => ({
      types: { isProxy: ambientDetector },
    }));
    replaceProcess(processShim({ getBuiltinModule }));
    vi.resetModules();
    const { isNativeAbortSignal } = await import("./abort-signal.js");
    const controller = new AbortController();
    const trap = vi.fn();

    await expect(isNativeAbortSignal(controller.signal)).resolves.toBe(true);
    await expect(isNativeAbortSignal(proxySignal(controller.signal, trap)))
      .resolves.toBe(false);

    expect(getBuiltinModule).not.toHaveBeenCalled();
    expect(ambientDetector).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
  });

  it("loads and validates with ambient process absent", async () => {
    replaceProcess(undefined);
    vi.resetModules();
    const { isNativeAbortSignal } = await import("./abort-signal.js");
    const controller = new AbortController();
    const trap = vi.fn();

    await expect(isNativeAbortSignal(controller.signal)).resolves.toBe(true);
    await expect(isNativeAbortSignal(proxySignal(controller.signal, trap)))
      .resolves.toBe(false);

    expect(trap).not.toHaveBeenCalled();
  });
});

function processShim(overrides: { getBuiltinModule: unknown }): object {
  return new Proxy(realProcess, {
    get(target, property) {
      if (property === "getBuiltinModule") {
        return overrides.getBuiltinModule;
      }
      return Reflect.get(target, property, target) as unknown;
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "getBuiltinModule") {
        return {
          configurable: true,
          enumerable: true,
          value: overrides.getBuiltinModule,
          writable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

function replaceProcess(value: object | undefined): void {
  Object.defineProperty(globalThis, "process", {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
}

function restoreProcess(): void {
  if (originalProcessDescriptor) {
    Object.defineProperty(globalThis, "process", originalProcessDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "process");
  }
}

function proxySignal(
  signal: AbortSignal,
  trap: ReturnType<typeof vi.fn>,
): AbortSignal {
  return new Proxy(signal, {
    get(target, property) {
      trap(`get:${String(property)}`);
      return Reflect.get(target, property, target) as unknown;
    },
    getOwnPropertyDescriptor() {
      trap("getOwnPropertyDescriptor");
      return undefined;
    },
    getPrototypeOf() {
      trap("getPrototypeOf");
      return AbortSignal.prototype;
    },
  });
}
