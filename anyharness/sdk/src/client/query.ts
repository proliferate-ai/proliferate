export type OwnQueryParameterKind = "string" | "safe-integer";

export type OwnQueryParameter =
  | { present: false }
  | { present: true; value: string };

/**
 * Normalize one fixed query field without reading through a prototype,
 * invoking an accessor, coercing an object, or iterating caller-owned data.
 * Callers decide which fields are required for their endpoint mode.
 */
export function normalizeOwnQueryParameter(
  input: unknown,
  property: string,
  kind: OwnQueryParameterKind,
): OwnQueryParameter {
  if (!isObjectLike(input)) {
    throw invalidQueryProperty(property);
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, property);
  } catch {
    throw invalidQueryProperty(property);
  }

  if (descriptor === undefined) {
    return { present: false };
  }
  // `hasOwnProperty.call`, not `Object.hasOwn`: apps/desktop typechecks these
  // sources under `lib: ES2021`, where `Object.hasOwn` does not exist.
  if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidQueryProperty(property);
  }

  const value = descriptor.value as unknown;
  if (kind === "string") {
    if (typeof value !== "string") {
      throw invalidQueryProperty(property);
    }
    return { present: true, value };
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidQueryProperty(property);
  }
  return { present: true, value: String(value) };
}

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null)
    || typeof value === "function"
  );
}

function invalidQueryProperty(property: string): TypeError {
  return new TypeError(`Invalid own query property: ${property}`);
}
