import { Button } from "@proliferate/ui";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm">Primary</Button>
    <Button size="sm" variant="secondary">Secondary</Button>
    <Button size="sm" variant="ghost">Ghost</Button>
    <Button size="sm" variant="destructive">Delete</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm">Small</Button>
    <Button>Default</Button>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Button size="sm">Enabled</Button>
    <Button size="sm" disabled>Disabled</Button>
    <Button size="sm" variant="secondary" disabled>Secondary disabled</Button>
  </div>
);
