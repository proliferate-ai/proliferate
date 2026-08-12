import { PageHeader } from "#product/primitives/patterns/PageHeader";
import type { LibraryEntry } from "../types";

/**
 * `PageHeader` grew a `variant` axis when it absorbed `SettingsPageHeader`'s
 * look, so the demo has to show both — a one-variant card would hide half the
 * component. Replaces the inline `PageHeader` row in `patterns.tsx`.
 */
function PageHeaderDemo() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      <PageHeader title="Page title" description="Page description" />
      <PageHeader
        variant="flat"
        title="Page title"
        description="Page description"
      />
    </div>
  );
}

export const PAGE_HEADER_ENTRY: LibraryEntry = {
  name: "PageHeader",
  subpath: "#product/primitives/patterns/PageHeader",
  render: PageHeaderDemo,
};
