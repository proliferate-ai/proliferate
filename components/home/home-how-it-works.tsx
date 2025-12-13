const steps = [
  {
    number: "01",
    title: "Connect",
    description: "Link your repo and logs. Five minutes, no config.",
  },
  {
    number: "02",
    title: "Understand",
    description: "AI learns your codebase, your users, your patterns.",
  },
  {
    number: "03",
    title: "Fix",
    description: "Get actionable issues with root cause and suggested fixes.",
  },
];

export function HomeHowItWorks() {
  return (
    <section className="py-20 md:py-28 bg-black border-t border-white/5">
      <div className="proliferate-container">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-4">
            How it works
          </h2>
          <p className="text-white/40 text-center mb-16 max-w-xl mx-auto">
            From zero to actionable insights in minutes, not days.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
