import { lazy, Suspense } from "react";
import type { ReactElement } from "react";

// Font stylesheet (side-effect import via @fontsource-variable) and shared
// product CSS. These prove font emission and the `@proliferate/design/product.css`
// resolution the real product depends on.
import "@fontsource-variable/inter";
import "@proliferate/design/product.css";

// Representative resource shapes the moved product actually uses:
import badgeUrl from "./assets/canary-badge.png"; // image → asset URL
import chimeUrl from "./assets/canary-chime.mp3"; // audio → asset URL
import glyphUrl from "./assets/canary-glyph.svg"; // svg → asset URL
import glyphMarkup from "./assets/canary-glyph.svg?raw"; // svg → inlined text
import registryRaw from "./assets/canary-registry.json?raw"; // json → inlined text
import generatedStyle from "./assets/canary-generated-style.json"; // generated json → normal import

// An additional lazy chunk, proving code-splitting within the authenticated tree
// (analogous to the real editor/terminal chunks the product loads on demand).
const CanaryLazyChunk = lazy(() => import("./canary-lazy-chunk"));

const generatedStyleSummary = JSON.stringify(generatedStyle);

// QUALIFICATION-ONLY. This is the lazy authenticated root of the build canary,
// never the product. It is loaded through `#product/qualification/...` from the
// public shell to prove the compiled package-private import + code-split shape.
export default function AuthenticatedProductClientBuildCanary(): ReactElement {
  return (
    <section
      data-testid="authenticated-product-client-build-canary"
      style={{ fontFamily: "'Inter Variable', system-ui, sans-serif" }}
    >
      <img src={badgeUrl} alt="" width={1} height={1} />
      <img src={glyphUrl} alt="" width={1} height={1} />
      <audio src={chimeUrl} />
      <pre data-raw-svg-length={glyphMarkup.length} />
      <pre data-raw-json-length={registryRaw.length} />
      <pre data-generated-style-length={generatedStyleSummary.length} />
      <Suspense fallback={<div data-testid="canary-lazy-chunk-fallback" />}>
        <CanaryLazyChunk />
      </Suspense>
    </section>
  );
}
