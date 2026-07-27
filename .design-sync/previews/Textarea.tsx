import { Textarea } from "@proliferate/ui";

export const Default = () => (
  <div className="w-72">
    <Textarea
      placeholder="Describe the change…"
      defaultValue={"Re-cut the cloud specs to the new rulings.\nChain-completion provisioning, org-only billing."}
      rows={4}
    />
  </div>
);

export const Empty = () => (
  <div className="w-72">
    <Textarea placeholder="Leave a review comment…" defaultValue="" rows={3} />
  </div>
);
