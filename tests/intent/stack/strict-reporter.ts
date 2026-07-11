import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/** Required Tier-2 scenarios may not turn missing setup into a green skip. */
export default class StrictTier2Reporter implements Reporter {
  private readonly outcomes = new Map<
    string,
    {
      title: string;
      finalStatus: TestResult["status"];
      expectedStatus: TestCase["expectedStatus"];
      sawFailedAttempt: boolean;
    }
  >();

  onTestEnd(test: TestCase, result: TestResult): void {
    const prior = this.outcomes.get(test.id);
    // Keep the final status, but never erase an actual failed attempt. A serial
    // group's later tests may be skipped after an earlier failure and then pass
    // on the group retry; only the test that actually failed is flaky.
    this.outcomes.set(test.id, {
      title: test.titlePath().filter(Boolean).join(" > "),
      finalStatus: result.status,
      expectedStatus: test.expectedStatus,
      sawFailedAttempt:
        prior?.sawFailedAttempt === true ||
        result.status === "failed" ||
        result.status === "timedOut" ||
        result.status === "interrupted",
    });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] } | void> {
    const nonPassing = [...this.outcomes.values()].filter(
      (outcome) =>
        outcome.expectedStatus !== "passed" ||
        outcome.finalStatus !== "passed" ||
        outcome.sawFailedAttempt,
    );
    if (nonPassing.length === 0) {
      return;
    }

    console.error("\nRequired Tier-2 scenarios were not clean first-attempt passes:");
    for (const outcome of nonPassing) {
      const status =
        outcome.expectedStatus !== "passed" && outcome.finalStatus === "passed"
          ? `unexpected pass (expected ${outcome.expectedStatus})`
          : outcome.finalStatus === "passed" && outcome.sawFailedAttempt
          ? "flaky (passed only after a failed attempt)"
          : outcome.finalStatus;
      console.error(`  - [${status}] ${outcome.title}`);
    }
    console.error(
      "A required Tier-2 run is green only when every scenario executes and passes without a failed retry.\n",
    );
    return { status: "failed" };
  }
}
