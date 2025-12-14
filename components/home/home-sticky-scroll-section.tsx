"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

const scrollSteps = [
  {
    id: "observe",
    title: "Don't just observe",
    subtitle: "Take action",
    description:
      "Traditional monitoring tools show you dashboards and charts. Proliferate gives you fixes. Every error comes with root cause analysis and actionable next steps.",
    visual: "action",
  },
  {
    id: "setup",
    title: "Easy setup",
    subtitle: "5 minutes to value",
    description:
      "No SDK sprawl. No instrumentation nightmare. Connect your repo and see issues immediately. We handle the rest.",
    visual: "setup",
  },
  {
    id: "triage",
    title: "Errors triaged",
    subtitle: "Automatically prioritized",
    description:
      "AI analyzes impact, frequency, and business context to surface what matters. Stop drowning in alerts, start shipping fixes.",
    visual: "triage",
  },
  {
    id: "fixed",
    title: "Errors fixed",
    subtitle: "Not just identified",
    description:
      "Get suggested code changes, not just stack traces. Understand the why, not just the what. Ship the fix in minutes.",
    visual: "fixed",
  },
];

// Dashboard fades back, action card comes forward
function ActionVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".dashboard-mock", { opacity: 0, scale: 0.95 });
      gsap.set(".dashboard-line", { scaleX: 0, transformOrigin: "left" });
      gsap.set(".action-card", { opacity: 0, y: 20, scale: 0.95 });
      gsap.set(".action-inner", { opacity: 0 });

      tl.to(".dashboard-mock", {
        opacity: 1,
        scale: 1,
        duration: 0.4,
        ease: "power2.out",
      });

      tl.to(".dashboard-line", {
        scaleX: 1,
        duration: 0.3,
        stagger: 0.06,
        ease: "power2.out",
      }, "-=0.2");

      tl.to(".dashboard-mock", {
        opacity: 0.1,
        scale: 0.92,
        filter: "blur(2px)",
        duration: 0.4,
        ease: "power2.inOut",
      }, "+=0.2");

      tl.to(".action-card", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.4,
        ease: "back.out(1.5)",
      }, "-=0.2");

      tl.to(".action-inner", {
        opacity: 1,
        duration: 0.25,
        stagger: 0.06,
        ease: "power2.out",
      }, "-=0.1");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      {/* Dashboard mockup (fades back) */}
      <div className="dashboard-mock absolute inset-2 sm:inset-4 bg-white/[0.02] rounded-lg border border-white/5 p-3 opacity-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
          <div className="h-1.5 w-12 bg-white/10 rounded" />
        </div>
        <div className="space-y-2">
          <div className="dashboard-line h-6 bg-white/[0.04] rounded" style={{ width: "70%" }} />
          <div className="dashboard-line h-6 bg-white/[0.04] rounded" style={{ width: "85%" }} />
          <div className="dashboard-line h-6 bg-white/[0.04] rounded" style={{ width: "50%" }} />
        </div>
      </div>

      {/* Action card (comes forward) */}
      <div className="action-card relative bg-white/[0.06] backdrop-blur-sm rounded-lg border border-white/10 p-4 w-56 sm:w-60 opacity-0">
        <div className="action-inner flex items-center gap-2 mb-2 opacity-0">
          <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-white/50 text-[11px] font-mono">TypeError</span>
        </div>
        <div className="action-inner text-white text-sm font-medium mb-1 opacity-0">
          Cannot read property &apos;id&apos;
        </div>
        <div className="action-inner text-white/40 text-[11px] font-mono mb-3 opacity-0">
          src/api/users.ts:142
        </div>
        <div className="action-inner opacity-0">
          <div className="bg-white text-black text-xs font-medium py-1.5 px-3 rounded-md text-center">
            Apply fix
          </div>
        </div>
      </div>
    </div>
  );
}

// Terminal with animated typing
function SetupVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".terminal", { opacity: 0, y: 15 });
      gsap.set(".terminal-dot", { scale: 0 });
      gsap.set(".terminal-line", { opacity: 0 });
      gsap.set(".progress-bar", { scaleX: 0, transformOrigin: "left" });
      gsap.set(".success-check", { scale: 0, opacity: 0 });

      tl.to(".terminal", {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: "power2.out",
      });

      tl.to(".terminal-dot", {
        scale: 1,
        duration: 0.2,
        stagger: 0.04,
        ease: "back.out(2)",
      }, "-=0.2");

      tl.to(".terminal-line-0", { opacity: 1, duration: 0.2 });

      tl.to(".progress-bar", {
        scaleX: 1,
        duration: 1,
        ease: "power2.inOut",
      }, "+=0.1");

      tl.to(".terminal-line-1", { opacity: 1, duration: 0.2 }, "-=0.3");

      tl.to(".success-check", {
        scale: 1,
        opacity: 1,
        duration: 0.3,
        ease: "back.out(2)",
      });

      tl.to(".terminal-line-2", { opacity: 1, duration: 0.2 }, "-=0.1");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="terminal bg-[#0a0a0a] rounded-lg border border-white/10 overflow-hidden opacity-0">
          {/* Terminal header */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.02] border-b border-white/5">
            <div className="terminal-dot w-2 h-2 rounded-full bg-white/20" />
            <div className="terminal-dot w-2 h-2 rounded-full bg-white/20" />
            <div className="terminal-dot w-2 h-2 rounded-full bg-white/20" />
            <span className="ml-2 text-white/30 text-[10px] font-mono">terminal</span>
          </div>

          <div className="p-3 sm:p-4 font-mono text-[11px] sm:text-xs space-y-2">
            <div className="terminal-line terminal-line-0 flex items-center text-white/50 opacity-0">
              <span className="text-white/30 mr-2">$</span>
              npx proliferate init
            </div>

            <div className="terminal-line terminal-line-1 text-white/40 opacity-0">
              <span className="text-white/30">→</span> Indexing repository...
            </div>

            <div className="h-1 bg-white/10 rounded-full overflow-hidden my-2">
              <div className="progress-bar h-full bg-white/50 rounded-full" />
            </div>

            <div className="terminal-line terminal-line-1 text-white/40 opacity-0">
              <span className="text-white/30">→</span> 2,847 files indexed
            </div>

            <div className="flex items-center gap-2 pt-1">
              <div className="success-check text-green-400 opacity-0">✓</div>
              <span className="terminal-line terminal-line-2 text-green-400/80 opacity-0">
                Ready in 3m 42s
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Alert cards sorting by priority - techie style
function TriageVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      // Cards start scattered with alert state
      gsap.set(".alert-card", {
        opacity: 0,
        x: (i) => [70, -60, 45][i],
        y: (i) => [-50, 20, 70][i],
        rotation: (i) => [12, -15, 8][i],
        scale: 0.9,
      });
      gsap.set(".alert-ping", { scale: 1, opacity: 0.8 });
      gsap.set(".alert-inner", { opacity: 1 });
      gsap.set(".alert-badge", { opacity: 0, scale: 0 });
      gsap.set(".alert-sparkline", { strokeDashoffset: 50 });
      gsap.set(".alert-count", { textContent: "0" });
      gsap.set(".triage-label", { opacity: 0, y: 10 });

      // Cards burst in scattered (already showing error state)
      tl.to(".alert-card", {
        opacity: 1,
        scale: 1,
        duration: 0.3,
        stagger: 0.1,
        ease: "back.out(1.5)",
      });

      // Ping animations on each card (staggered)
      tl.to(".alert-ping-0", {
        scale: 2,
        opacity: 0,
        duration: 0.6,
        repeat: 2,
        ease: "power2.out",
      }, "-=0.2");

      tl.to(".alert-ping-1", {
        scale: 2,
        opacity: 0,
        duration: 0.6,
        repeat: 2,
        ease: "power2.out",
      }, "-=1.5");

      tl.to(".alert-ping-2", {
        scale: 2,
        opacity: 0,
        duration: 0.6,
        repeat: 2,
        ease: "power2.out",
      }, "-=1.5");

      // Cards shake while alerting
      tl.to(".alert-card", {
        x: (i) => [70, -60, 45][i] + "+=random(-4, 4)",
        y: (i) => [-50, 20, 70][i] + "+=random(-3, 3)",
        duration: 0.08,
        repeat: 10,
        yoyo: true,
        ease: "none",
      }, "-=1.8");

      // Pause to show chaos
      tl.to({}, { duration: 0.3 });

      // Sort into organized positions
      tl.to(".alert-card", {
        x: 0,
        y: 0,
        rotation: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.inOut",
      });

      // Sparklines draw
      tl.to(".alert-sparkline", {
        strokeDashoffset: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out",
      }, "-=0.4");

      // Badges pop in
      tl.to(".alert-badge", {
        opacity: 1,
        scale: 1,
        duration: 0.3,
        stagger: 0.08,
        ease: "back.out(2)",
      }, "-=0.4");

      // Count up animation
      tl.to(".alert-count-0", {
        textContent: "847",
        duration: 0.5,
        snap: { textContent: 1 },
        ease: "power2.out",
      }, "-=0.5");
      tl.to(".alert-count-1", {
        textContent: "234",
        duration: 0.4,
        snap: { textContent: 1 },
        ease: "power2.out",
      }, "-=0.4");
      tl.to(".alert-count-2", {
        textContent: "89",
        duration: 0.3,
        snap: { textContent: 1 },
        ease: "power2.out",
      }, "-=0.3");

      // Label fades in
      tl.to(".triage-label", {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: "power2.out",
      }, "-=0.2");

      // First card subtle glow pulse
      tl.to(".alert-card-0", {
        boxShadow: "0 0 20px rgba(239,68,68,0.15)",
        duration: 1,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });

    }, containerRef);

    return () => ctx.revert();
  }, []);

  const alerts = [
    {
      type: "critical",
      title: "TIMEOUT",
      endpoint: "/api/payments/webhook",
      count: 847,
      trend: [2, 5, 8, 12, 18, 25, 35, 42],
      priority: 1,
      color: "#ef4444",
    },
    {
      type: "high",
      title: "AUTH_LOOP",
      endpoint: "/api/auth/refresh",
      count: 234,
      trend: [8, 12, 10, 15, 18, 14, 16, 19],
      priority: 2,
      color: "#f97316",
    },
    {
      type: "medium",
      title: "SLOW_QUERY",
      endpoint: "db.users.find()",
      count: 89,
      trend: [5, 4, 6, 5, 7, 6, 5, 6],
      priority: 3,
      color: "#fbbf24",
    },
  ];

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      {/* Cards container */}
      <div className="w-full max-w-sm space-y-2 relative">
        {alerts.map((alert, i) => (
          <div
            key={i}
            className={`alert-card alert-card-${i} relative rounded-lg bg-[#0a0a0a] border opacity-0 overflow-hidden`}
            style={{ borderColor: `${alert.color}30` }}
          >
            {/* Ping indicator for alerting state */}
            <div
              className={`alert-ping alert-ping-${i} absolute -top-1 -right-1 w-3 h-3 rounded-full`}
              style={{ backgroundColor: alert.color }}
            />

            {/* Header bar with severity color */}
            <div
              className="h-0.5"
              style={{ background: alert.color }}
            />

            <div className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Error type badge */}
                  <div className="alert-inner flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${alert.color}20`,
                        color: alert.color,
                      }}
                    >
                      {alert.title}
                    </span>
                  </div>

                  {/* Endpoint/location */}
                  <div className="alert-inner text-white/40 text-[11px] font-mono truncate">
                    {alert.endpoint}
                  </div>

                  {/* Stats row */}
                  <div className="alert-inner flex items-center gap-3 mt-2">
                    {/* Count */}
                    <div className="flex items-baseline gap-1">
                      <span className={`alert-count alert-count-${i} text-white/80 text-sm font-mono font-medium`}>
                        0
                      </span>
                      <span className="text-white/30 text-[10px]">errors</span>
                    </div>

                    {/* Mini sparkline */}
                    <svg width="48" height="16" className="overflow-visible">
                      <path
                        className="alert-sparkline"
                        d={`M0,${14 - alert.trend[0] * 0.3} ${alert.trend.map((v, j) => `L${j * 7},${14 - v * 0.3}`).join(' ')}`}
                        fill="none"
                        stroke={`${alert.color}90`}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray="50"
                      />
                    </svg>
                  </div>
                </div>

                {/* Priority badge */}
                <div
                  className="alert-badge flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono font-bold opacity-0"
                  style={{
                    backgroundColor: `${alert.color}20`,
                    color: alert.color,
                  }}
                >
                  P{alert.priority}
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="triage-label flex items-center justify-center gap-2 text-white/30 text-xs pt-3 opacity-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span>Auto-prioritized by impact</span>
        </div>
      </div>
    </div>
  );
}

// Code diff with fix being applied
function FixedVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".code-window", { opacity: 0, y: 15, scale: 0.95 });
      gsap.set(".code-line", { opacity: 0, x: -10 });
      gsap.set(".code-old", { opacity: 0 });
      gsap.set(".code-new", { opacity: 0, x: -20 });
      gsap.set(".code-highlight", { scaleX: 0, transformOrigin: "left" });
      gsap.set(".success-card", { opacity: 0, y: 15, scale: 0.95 });
      gsap.set(".success-inner", { opacity: 0 });

      // Window appears
      tl.to(".code-window", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.5,
        ease: "power3.out",
      });

      // Context lines fade in
      tl.to(".code-line", {
        opacity: 1,
        x: 0,
        duration: 0.3,
        stagger: 0.05,
        ease: "power2.out",
      }, "-=0.2");

      // Old line appears (with error)
      tl.to(".code-old", {
        opacity: 1,
        duration: 0.3,
      }, "-=0.1");

      // Strike through old
      tl.to(".code-old", {
        textDecoration: "line-through",
        opacity: 0.4,
        duration: 0.3,
      }, "+=0.3");

      // New line slides in
      tl.to(".code-new", {
        opacity: 1,
        x: 0,
        duration: 0.4,
        ease: "power2.out",
      });

      // Highlight new line
      tl.to(".code-highlight", {
        scaleX: 1,
        duration: 0.4,
        ease: "power2.out",
      }, "-=0.3");

      // Success card appears
      tl.to(".success-card", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.5,
        ease: "back.out(1.5)",
      }, "+=0.2");

      // Inner content
      tl.to(".success-inner", {
        opacity: 1,
        duration: 0.3,
        stagger: 0.1,
        ease: "power2.out",
      }, "-=0.2");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="w-full max-w-sm space-y-3">
        {/* Code window */}
        <div className="code-window bg-[#0a0a0a] rounded-xl border border-white/10 overflow-hidden opacity-0">
          <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/5">
            <span className="text-white/30 text-xs font-mono">src/api/users.ts</span>
            <span className="text-white/20 text-xs">Suggested fix</span>
          </div>
          <div className="p-4 font-mono text-xs space-y-1">
            <div className="code-line text-white/30 opacity-0">
              <span className="text-white/20 mr-3">140</span>
              {"  const user = await db.find(id);"}
            </div>
            <div className="code-line text-white/30 opacity-0">
              <span className="text-white/20 mr-3">141</span>
              {"  "}
            </div>
            <div className="relative">
              <div className="code-old text-red-400/70 opacity-0">
                <span className="text-white/20 mr-3">142</span>
                {"  return user.profile.name;"}
              </div>
            </div>
            <div className="relative">
              <div className="code-highlight absolute inset-0 bg-green-500/10 rounded" />
              <div className="code-new text-green-400/80 relative opacity-0">
                <span className="text-white/20 mr-3">142</span>
                {"  return user?.profile?.name ?? null;"}
              </div>
            </div>
            <div className="code-line text-white/30 opacity-0">
              <span className="text-white/20 mr-3">143</span>
              {"}"}
            </div>
          </div>
        </div>

        {/* Success card */}
        <div className="success-card bg-white/[0.04] rounded-lg border border-white/10 p-3 opacity-0">
          <div className="flex items-center gap-3">
            <div className="success-inner w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center opacity-0">
              <span className="text-white/70">✓</span>
            </div>
            <div className="flex-1">
              <div className="success-inner text-white/80 text-sm font-medium opacity-0">
                Fix applied
              </div>
              <div className="success-inner text-white/40 text-xs opacity-0">
                Error rate: 2,847 → 0
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const visualComponents: Record<string, React.FC> = {
  action: ActionVisual,
  setup: SetupVisual,
  triage: TriageVisual,
  fixed: FixedVisual,
};

export function HomeStickyScrollSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const visualWrapperRef = useRef<HTMLDivElement>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sectionRefs.current.forEach((ref, index) => {
      if (!ref) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
              setActiveIndex(index);
            }
          });
        },
        {
          threshold: 0.5,
          rootMargin: "-30% 0px -30% 0px",
        }
      );

      observer.observe(ref);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  // Handle visual transition with GSAP
  useEffect(() => {
    if (activeIndex === displayIndex) return;
    if (!visualWrapperRef.current) return;

    if (tweenRef.current) {
      tweenRef.current.kill();
    }

    const wrapper = visualWrapperRef.current;

    tweenRef.current = gsap.to(wrapper, {
      opacity: 0,
      scale: 0.95,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => {
        setDisplayIndex(activeIndex);
        gsap.to(wrapper, {
          opacity: 1,
          scale: 1,
          duration: 0.3,
          ease: "power2.out",
        });
      },
    });
  }, [activeIndex, displayIndex]);

  const ActiveVisual = visualComponents[scrollSteps[displayIndex].visual];

  return (
    <section className="bg-black border-t border-white/5">
      <div className="proliferate-container">
        <div className="py-16 md:py-24">
          {/* Section header */}
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-3">
              Stop watching. Start fixing.
            </h2>
            <p className="text-white/40 max-w-lg mx-auto text-sm sm:text-base">
              From error to resolution in minutes, not days.
            </p>
          </div>

          {/* Sticky scroll container */}
          <div ref={containerRef} className="relative">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
              {/* Left: Sticky visual */}
              <div className="order-1 lg:order-1">
                <div className="lg:sticky lg:top-32 h-[280px] sm:h-[320px] lg:h-[380px]">
                  <div className="relative w-full h-full rounded-xl bg-white/[0.02] border border-white/10 overflow-hidden">
                    <div
                      ref={visualWrapperRef}
                      className="absolute inset-0 p-4 sm:p-6"
                    >
                      <ActiveVisual key={displayIndex} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Scrolling text sections */}
              <div className="order-2 lg:order-2">
                {scrollSteps.map((step, index) => (
                  <div
                    key={step.id}
                    ref={(el) => {
                      sectionRefs.current[index] = el;
                    }}
                    className={`py-8 lg:py-16 lg:min-h-[380px] flex items-start lg:items-center transition-all duration-300 ${
                      activeIndex === index ? "opacity-100" : "lg:opacity-30"
                    }`}
                  >
                    <div>
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium mb-3 transition-all duration-300 ${
                          activeIndex === index
                            ? "bg-white/10 text-white/80"
                            : "bg-white/5 text-white/40"
                        }`}
                      >
                        {step.subtitle}
                      </span>
                      <h3 className="text-xl sm:text-2xl lg:text-3xl font-semibold text-white mb-3">
                        {step.title}
                      </h3>
                      <p className="text-white/50 text-sm sm:text-base leading-relaxed max-w-sm">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
