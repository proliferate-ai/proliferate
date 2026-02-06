"use client";

const useCases = [
  {
    title: "Bug detected → PR ready",
    description: "Sentry fires, agent investigates, fix is drafted. Review code, not alerts.",
  },
  {
    title: "Feature request → testable preview",
    description: "Linear ticket created, agent builds it, preview link posts to Slack.",
  },
  {
    title: "Flaky tests → auto-fixed",
    description: "CI fails, agent identifies flake, patches it, verifies it passes.",
  },
  {
    title: "Docs outdated → auto-updated",
    description: "Code changes detected, agent updates docs to match.",
  },
];

export function HomeUseCasesSection() {
  return (
    <section className="w-full py-20 md:py-28 bg-black">
      <div className="proliferate-container">
        <div className="flex flex-col w-full max-w-5xl mx-auto gap-12">
          {/* Header */}
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-3">
              Use cases
            </h2>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {useCases.map((useCase, index) => (
              <div
                key={index}
                className="p-6 rounded-xl"
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <h3 className="text-lg font-semibold text-white mb-2">
                  {useCase.title}
                </h3>
                <p className="text-white/50 text-sm leading-relaxed">
                  {useCase.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
