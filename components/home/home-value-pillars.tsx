import { Zap, Target, Brain } from "lucide-react";

const pillars = [
  {
    icon: Zap,
    title: "Set up in minutes",
    description:
      "No instrumentation hell. No config files. Connect your repo and start seeing issues immediately.",
  },
  {
    icon: Target,
    title: "Signal, not noise",
    description:
      "Not 500 alerts. One root cause with full context. Know exactly what broke and why.",
  },
  {
    icon: Brain,
    title: "Knows your codebase",
    description:
      "Understands your code, your customers, your business. Context-aware fixes, not generic stack traces.",
  },
];

export function HomeValuePillars() {
  return (
    <section className="py-20 md:py-28 bg-black border-t border-white/5">
      <div className="proliferate-container">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
            {pillars.map((pillar, index) => (
              <div key={index} className="text-center md:text-left">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/5 mb-5">
                  <pillar.icon className="w-5 h-5 text-white/70" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">
                  {pillar.title}
                </h3>
                <p className="text-white/40 leading-relaxed">
                  {pillar.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
