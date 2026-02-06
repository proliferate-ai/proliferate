const steps = [
  {
    number: "01",
    title: "Connect your codebase",
    description: "Sign in with GitHub",
  },
  {
    number: "02",
    title: "Connect your signals",
    description: "Link Sentry, Linear, Slack",
  },
  {
    number: "03",
    title: "Set your triggers",
    description: "Define what kicks off work",
  },
  {
    number: "04",
    title: "Review and ship",
    description: "Approve PRs, not tickets",
  },
];

export function HomeHowItWorks() {
  return (
    <section className="py-20 md:py-28 bg-black border-t border-white/5">
      <div className="proliferate-container">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-4">
            Get started
          </h2>
          <p className="text-white/40 text-center mb-16 max-w-xl mx-auto">
            From zero to shipping in minutes.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-px bg-white/10" />
                )}

                <div className="text-center">
                  <span className="text-5xl md:text-6xl font-bold text-white/10 block mb-4">
                    {step.number}
                  </span>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-white/40">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
