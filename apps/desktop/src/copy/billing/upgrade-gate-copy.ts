export interface UpgradeGateCopy {
  title: string;
  description: string;
  benefitsTitle: string;
  benefits: string[];
  footnote?: string;
  confirmLabel: string;
  cancelLabel: string;
}

export const TEAM_UPGRADE_GATE_COPY: UpgradeGateCopy = {
  title: "Upgrade to Team",
  description:
    "Create a Team when you are ready to share cloud runtime, agent auth, and collaboration settings with everyone you invite.",
  benefitsTitle: "Team includes",
  benefits: [
    "Members, invitations, and admin roles",
    "Organization cloud work, Slack sessions, and workflows",
    "Organization integrations, MCPs, skills, and synced agent auth",
    "20 managed-cloud hours per user each month",
  ],
  footnote: "You will review seats and payment details in Stripe before anything is charged.",
  confirmLabel: "Continue to checkout",
  cancelLabel: "Not now",
};
