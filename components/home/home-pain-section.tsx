"use client";

const problems = [
  {
    text: "You can only test one feature at a time locally",
  },
  {
    text: "PMs find out about bugs after Sentry fires",
  },
  {
    text: "Non-technical teammates can't ship code",
  },
];

export function HomePainSection() {
  return (
    <section
      className="w-full py-16 md:py-20"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      <div className="proliferate-container">
        <div className="flex flex-col w-full max-w-5xl mx-auto">
          {/* Problem Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {problems.map((problem, index) => (
              <div
                key={index}
                className="flex items-center justify-center p-6 rounded-xl text-center"
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <p className="text-white/60 text-sm sm:text-base leading-relaxed">
                  &ldquo;{problem.text}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
