import { MarsIcon } from "../ui/icons";
import { TelescopeIcon } from "../ui/icons";
import { ToolBoxIcon } from "../ui/icons";
const features = [
  {
    number: "001",
    category: "SETUP",
    title: "Instant observability",
    description:
      "Proliferate instruments itself.",
    icon: <TelescopeIcon size={256} color="white" />,

  },
  {
    number: "002",
    category: "CONTEXT",
    title: "Smart integrations",
    description:
      "We have the context necessary to actually take things off your plate.",
      icon: <ToolBoxIcon size={256} color="white" />,
    },
  {
    number: "003",
    category: "FIX",
    title: "Auto-pilot fix",
    description:
      "Stop doing grunt work. Let Proliferate take care of it.",
    icon: <MarsIcon size={256} color="white" />,
  },
];

export function HomePainSection() {
  return (
    <section
      className="w-full py-20 md:py-28"
      style={{ backgroundColor: "#0a0a0a" }}
    >
      <div className="proliferate-container">
        <div className="flex flex-col w-full max-w-5xl mx-auto gap-16">
          {/* Header Section */}
          <div className="text-white max-w-[45rem]">
            <div className="flex flex-col gap-6">
              <p
                className="text-xs uppercase tracking-[0.15em] font-medium"
                style={{ color: "rgba(255, 255, 255, 0.4)" }}
              >
                Stop fighting your software
              </p>
              <div className="flex flex-col gap-5">
                <h2 className="text-[clamp(2rem,5vw,3rem)] leading-[1.1] font-bold tracking-[-0.02em]">
                  AI maintenance crew
                </h2>
                <p className="text-base leading-[1.6] text-white/50 max-w-xl">
                  Stop digging through logs to understand what broke.
                  Proliferate autonomously triages every error, captures full
                  context, and drafts a fix.
                </p>
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            {features.map((feature, index) => (
              <div key={index} className="group">
                <div
                  className="flex flex-col justify-between h-full rounded-xl p-6"
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                  }}
                >
                  {/* Card Content */}
                  <div className="flex flex-col gap-8">
                    <div className="flex flex-col gap-6">
                      {/* Icon Area */}
                      <div
                        className="relative flex items-center justify-center h-52 rounded-lg overflow-hidden"
                        style={{ backgroundColor: "#050505" }}
                      >
                        {/* Grid pattern overlay */}
                        <div className="absolute inset-0 opacity-20">
                          <svg
                            className="w-full h-full"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <defs>
                              <pattern
                                id={`home-grid-${index}`}
                                width="32"
                                height="32"
                                patternUnits="userSpaceOnUse"
                              >
                                <path
                                  d="M 32 0 L 0 0 0 32"
                                  fill="none"
                                  stroke="rgba(255,255,255,0.1)"
                                  strokeWidth="1"
                                />
                              </pattern>
                            </defs>
                            <rect
                              width="100%"
                              height="100%"
                              fill={`url(#home-grid-${index})`}
                            />
                          </svg>
                        </div>
                        {/* Gradient glow effect */}
                        <div className="absolute inset-0">
                          <div className="w-full h-full bg-[radial-gradient(circle_at_center,_rgba(255,_255,_255,_0.08)_0%,_transparent_70%)]" />
                        </div>
                        {/* Icon with a light gradient fading to transparent toward the edges, same rounded shape but more pronounced edge transparency */}
                        <div className="relative z-10 w-56 h-42 rounded-[2rem/1.5rem] overflow-hidden flex items-center justify-center">
                          {/* Faint white-to-transparent edge gradient */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              borderRadius: '2rem 2rem 1.5rem 1.5rem / 1.5rem 1.5rem 1.5rem 1.5rem',
                              // Radial gradient with white at center, very transparent at edge
                              background: "radial-gradient(ellipse at center, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.01) 92%, transparent 100%)",
                              zIndex: 1,
                            }}
                          />
                          <div
                            className="relative flex items-center justify-center w-full h-full"
                            style={{
                              backgroundColor: "rgba(255,255,255,0.05)",
                              borderRadius: '2rem 2rem 1.5rem 1.5rem / 1.5rem 1.5rem 1.5rem 1.5rem',
                              zIndex: 2,
                            }}
                          >
                            {feature.icon}
                          </div>
                        </div>
                      </div>

                      {/* Text Content */}
                      <div className="flex flex-col gap-3">
                        <h4 className="text-lg font-semibold text-white tracking-[-0.01em]">
                          {feature.title}
                        </h4>
                        <p className="text-sm leading-[1.6] text-white/40">
                          {feature.description}
                        </p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div
                      className="flex justify-between items-center pt-5 border-t"
                      style={{ borderColor: "rgba(255, 255, 255, 0.05)" }}
                    >
                      <p className="text-xs uppercase tracking-[0.1em] font-medium text-white/30">
                        {feature.category}
                      </p>
                      <p className="text-xs text-white/20">{feature.number}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
