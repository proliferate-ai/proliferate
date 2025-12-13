import { Code, MessageSquare, Bell, GitBranch } from "lucide-react";

export function FeaturesDetailSection() {
  const features = [
    {
      icon: Code,
      title: "Five lines of code",
      description: "Install our SDK, pass in accountId and userId. We capture errors, network requests, user actions, and AI calls. Runs async, zero latency. Works with React, Node, Python.",
    },
    {
      icon: MessageSquare,
      title: "AI-powered session replay",
      description: "Not video playback—intelligent summaries. \"User clicked Export, got a timeout on /api/pdf, retried twice, then left.\" See the exact state, the exact error, the exact moment.",
    },
    {
      icon: Bell,
      title: "VIP alerts in Slack",
      description: "Mark your top accounts. When something breaks, you know in 60 seconds. The alert includes: who, what they were doing, what broke, and a link to the full session.",
    },
    {
      icon: GitBranch,
      title: "\"Is this fixed in main?\"",
      description: "Before you panic, Proliferate checks if a recent PR already addressed the issue. If not, click to open the fix flow with full context—error, code, user state, similar past issues.",
    },
  ];

  return (
    <section className="py-20 bg-black border-t border-zinc-800">
      <div className="proliferate-container mx-auto px-5">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-[0.15em] font-medium text-zinc-500 mb-4">
            THE DETAILS
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
            Built for B2B from day one
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {features.map((feature, index) => (
            <div
              key={index}
              className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                  <feature.icon className="w-5 h-5 text-zinc-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
