export interface ArtifactLibraryDescriptor {
  moduleName: string;
  url: string;
}

export const ARTIFACT_RUNTIME_SCRIPT_ORIGINS = [
  "https://cdn.jsdelivr.net",
  "https://esm.sh",
] as const;

export const TAILWIND_BROWSER_URL =
  "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.2";

export const REACT_DOM_CLIENT_DESCRIPTOR: ArtifactLibraryDescriptor = {
  moduleName: "react-dom/client",
  url: "https://esm.sh/react-dom@19.2.0/client",
};

export const LIBRARY_REGISTRY: Record<string, ArtifactLibraryDescriptor> = {
  react: {
    moduleName: "react",
    url: "https://esm.sh/react@19.2.0",
  },
  "react-dom": {
    moduleName: "react-dom",
    url: "https://esm.sh/react-dom@19.2.0",
  },
  "lucide-react": {
    moduleName: "lucide-react",
    url: "https://esm.sh/lucide-react@0.525.0?external=react",
  },
  recharts: {
    moduleName: "recharts",
    url: "https://esm.sh/recharts@2.15.4?external=react,react-dom",
  },
  lodash: {
    moduleName: "lodash",
    url: "https://esm.sh/lodash@4.17.21",
  },
  d3: {
    moduleName: "d3",
    url: "https://esm.sh/d3@7.9.0",
  },
  "date-fns": {
    moduleName: "date-fns",
    url: "https://esm.sh/date-fns@4.1.0",
  },
};

export function resolveArtifactLibraries(moduleNames: string[]): {
  libraries: ArtifactLibraryDescriptor[];
  unsupported: string[];
} {
  const libraries: ArtifactLibraryDescriptor[] = [];
  const unsupported: string[] = [];

  for (const moduleName of moduleNames) {
    const descriptor = LIBRARY_REGISTRY[moduleName];
    if (!descriptor) {
      unsupported.push(moduleName);
      continue;
    }
    libraries.push(descriptor);
  }

  return { libraries, unsupported };
}
