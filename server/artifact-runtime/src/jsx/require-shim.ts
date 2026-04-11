import type { ArtifactLibraryDescriptor } from "./library-registry";

export function buildRequireShim(libraries: ArtifactLibraryDescriptor[]): string {
  const registryEntries = libraries.map((library, index) =>
    `${JSON.stringify(library.moduleName)}: lib${index}`,
  );
  return `
const registry = {${registryEntries.join(",")}};
function require(moduleName) {
  const value = registry[moduleName];
  if (!value) {
    throw new Error("Unsupported module: " + moduleName);
  }
  return value;
}
`;
}
