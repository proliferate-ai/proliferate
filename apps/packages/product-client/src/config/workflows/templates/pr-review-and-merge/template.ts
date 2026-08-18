import preparePullRequestPrompt from "./prompts/prepare-pull-request.md?raw";
import reviewPullRequestPrompt from "./prompts/review-pull-request.md?raw";
import addressReviewPrompt from "./prompts/address-review.md?raw";
import proveMergeReadinessPrompt from "./prompts/prove-merge-readiness.md?raw";
import approveMergePrompt from "./prompts/approve-merge.md?raw";
import mergePullRequestPrompt from "./prompts/merge-pull-request.md?raw";
import deliveryRecordBody from "./context/delivery-record.md?raw";
import reviewFindingsBody from "./context/review-findings.md?raw";
import reviewResolutionBody from "./context/review-resolution.md?raw";
import mergeReadinessBody from "./context/merge-readiness.md?raw";
import mergeReceiptBody from "./context/merge-receipt.md?raw";

export const PR_REVIEW_AND_MERGE_TEMPLATE = {
  slug: "pr-review-and-merge",
  title: "PR review and merge",
  description:
    "Review an implemented change, repair material findings, prove the final head is merge-ready, and merge only after approval.",
  definition: {
    schemaVersion: 2 as const,
    nodes: [
      {
        id: "prepare-pull-request",
        type: "agent" as const,
        title: "Prepare the pull request",
        prompt: preparePullRequestPrompt,
      },
      {
        id: "review-pull-request",
        type: "agent" as const,
        title: "Review independently",
        prompt: reviewPullRequestPrompt,
      },
      {
        id: "address-review",
        type: "agent" as const,
        title: "Address review findings",
        prompt: addressReviewPrompt,
      },
      {
        id: "prove-merge-readiness",
        type: "agent" as const,
        title: "Prove merge readiness",
        prompt: proveMergeReadinessPrompt,
      },
      {
        id: "approve-merge",
        type: "human_in_loop" as const,
        title: "Approve the merge",
        prompt: approveMergePrompt,
      },
      {
        id: "merge-pull-request",
        type: "agent" as const,
        title: "Merge the pull request",
        prompt: mergePullRequestPrompt,
      },
    ],
    edges: [
      { from: "prepare-pull-request", to: "review-pull-request" },
      { from: "review-pull-request", to: "address-review" },
      { from: "address-review", to: "prove-merge-readiness" },
      { from: "prove-merge-readiness", to: "approve-merge" },
      { from: "approve-merge", to: "merge-pull-request" },
    ],
    inputs: [
      {
        name: "pull_request_url",
        description: "The pull request to review, improve, and prepare for merge.",
        required: true,
      },
      {
        name: "change_context",
        description:
          "The accepted issue, specification, requirements, or human rulings the change must satisfy.",
        required: false,
      },
      {
        name: "issue_url",
        description: "The linked issue to close after a successful merge, when applicable.",
        required: false,
      },
    ],
    docTemplates: [
      {
        slug: "delivery-record",
        producingNodeId: "prepare-pull-request",
        body: deliveryRecordBody,
      },
      {
        slug: "review-findings",
        producingNodeId: "review-pull-request",
        body: reviewFindingsBody,
      },
      {
        slug: "review-resolution",
        producingNodeId: "address-review",
        body: reviewResolutionBody,
      },
      {
        slug: "merge-readiness",
        producingNodeId: "prove-merge-readiness",
        body: mergeReadinessBody,
      },
      {
        slug: "merge-receipt",
        producingNodeId: "merge-pull-request",
        body: mergeReceiptBody,
      },
    ],
  },
};
