// Type declarations for make-updater-test-conf.mjs so the config-guard test
// (which imports the pure helpers) type-checks under the app's `tsc` build.

export interface UpdaterOverlay {
  plugins: {
    updater: {
      endpoints: string[];
      pubkey: string;
      dangerousInsecureTransportProtocol?: boolean;
    };
  };
}

export function renderOverlay(
  templateText: string,
  opts: { url: string; pubkey: string },
): UpdaterOverlay;

export function assertOnlyUpdaterKeys(overlay: unknown): void;
