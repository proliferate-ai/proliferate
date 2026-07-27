import { Input } from "@proliferate/ui";

export const Default = () => (
  <div className="flex w-64 flex-col gap-2">
    <Input placeholder="Search repositories" defaultValue="" />
    <Input defaultValue="proliferate-ai/proliferate" />
  </div>
);

export const Variants = () => (
  <div className="flex w-64 flex-col gap-2">
    <Input variant="default" defaultValue="Default variant" />
    <Input variant="unstyled" defaultValue="Unstyled variant" />
  </div>
);

export const Disabled = () => (
  <div className="flex w-64 flex-col gap-2">
    <Input defaultValue="Editable" />
    <Input defaultValue="Read only" disabled />
  </div>
);
