"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

// Preload all background images
const backgroundImages = [
  '/assets/hero/mars.jpeg',
  '/assets/hero/mars-2.jpeg',
  '/assets/hero/mars-3.jpeg',
  '/assets/hero/mars-4.jpeg',
];

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
      <div className="dashboard-mock absolute inset-2 sm:inset-4 bg-red-950/30 rounded-lg border border-red-500/20 p-3 opacity-0">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-red-400/40" />
          <div className="h-1.5 w-12 bg-red-400/20 rounded" />
        </div>
        <div className="space-y-2">
          <div className="dashboard-line h-6 bg-red-400/10 rounded" style={{ width: "70%" }} />
          <div className="dashboard-line h-6 bg-red-400/10 rounded" style={{ width: "85%" }} />
          <div className="dashboard-line h-6 bg-red-400/10 rounded" style={{ width: "50%" }} />
        </div>
      </div>

      {/* Action card (comes forward) */}
      <div className="action-card relative bg-red-950/60 backdrop-blur-sm rounded-lg border border-red-400/30 p-4 w-56 sm:w-60 opacity-0">
        <div className="action-inner flex items-center gap-2 mb-2 opacity-0">
          <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-red-200/70 text-[11px] font-mono">TypeError</span>
        </div>
        <div className="action-inner text-white text-sm font-medium mb-1 opacity-0">
          Cannot read property &apos;id&apos;
        </div>
        <div className="action-inner text-red-200/50 text-[11px] font-mono mb-3 opacity-0">
          src/api/users.ts:142
        </div>
        <div className="action-inner opacity-0">
          <div className="bg-red-400 text-red-950 text-xs font-medium py-1.5 px-3 rounded-md text-center">
            Apply fix
          </div>
        </div>
      </div>
    </div>
  );
}

// Abstract rings loading animation
function SetupVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".setup-container", { opacity: 0 });
      gsap.set(".ring", { scale: 0, opacity: 0, rotation: 0 });
      gsap.set(".center-dot", { scale: 0 });
      gsap.set(".setup-label", { opacity: 0, y: 10 });

      tl.to(".setup-container", { opacity: 1, duration: 0.3 });

      // Rings expand outward
      tl.to(".ring-1", { scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" });
      tl.to(".ring-2", { scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.3");
      tl.to(".ring-3", { scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.3");

      // Rings rotate
      tl.to(".ring-1", { rotation: 360, duration: 2, ease: "none", repeat: -1 }, "-=0.5");
      tl.to(".ring-2", { rotation: -360, duration: 3, ease: "none", repeat: -1 }, "-=2");
      tl.to(".ring-3", { rotation: 360, duration: 4, ease: "none", repeat: -1 }, "-=3");

      // Center dot
      tl.to(".center-dot", { scale: 1, duration: 0.4, ease: "back.out(2)" }, "-=3.5");

      // Label
      tl.to(".setup-label", { opacity: 1, y: 0, duration: 0.4 }, "-=3");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="setup-container relative opacity-0">
        {/* Concentric rings */}
        <div className="relative w-48 h-48">
          <div className="ring ring-3 absolute inset-0 rounded-full border-2 border-blue-500/30 opacity-0" />
          <div className="ring ring-2 absolute inset-6 rounded-full border-2 border-dashed border-blue-400/40 opacity-0" />
          <div className="ring ring-1 absolute inset-12 rounded-full border-2 border-blue-400/60 opacity-0" />

          {/* Dots on rings */}
          <div className="ring ring-1 absolute inset-12 rounded-full opacity-0">
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-400" />
          </div>
          <div className="ring ring-2 absolute inset-6 rounded-full opacity-0">
            <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400/80" />
            <div className="absolute -bottom-1 left-1/3 w-2 h-2 rounded-full bg-blue-400/80" />
          </div>
          <div className="ring ring-3 absolute inset-0 rounded-full opacity-0">
            <div className="absolute top-4 right-4 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
            <div className="absolute bottom-8 left-2 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
            <div className="absolute top-1/2 -left-0.5 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
          </div>

          {/* Center */}
          <div className="center-dot absolute inset-0 flex items-center justify-center scale-0">
            <div className="w-10 h-10 rounded-full bg-blue-500/30 border-2 border-blue-400 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-blue-400" />
            </div>
          </div>
        </div>

        {/* Label */}
        <div className="setup-label absolute -bottom-8 left-1/2 -translate-x-1/2 text-blue-300 text-[11px] whitespace-nowrap opacity-0">
          Connecting to your codebase
        </div>
      </div>
    </div>
  );
}

// Scattered errors organize into card deck
function TriageVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".triage-container", { opacity: 0 });
      // Scattered positions
      gsap.set(".error-card-0", { x: -60, y: -40, rotation: -15, opacity: 0 });
      gsap.set(".error-card-1", { x: 50, y: -30, rotation: 12, opacity: 0 });
      gsap.set(".error-card-2", { x: -40, y: 20, rotation: -8, opacity: 0 });
      gsap.set(".error-card-3", { x: 70, y: 30, rotation: 18, opacity: 0 });
      gsap.set(".error-card-4", { x: -20, y: 50, rotation: -5, opacity: 0 });
      gsap.set(".triage-label", { opacity: 0 });

      tl.to(".triage-container", { opacity: 1, duration: 0.3 });

      // Cards appear scattered
      tl.to(".error-card", {
        opacity: 1,
        duration: 0.3,
        stagger: 0.08,
      });

      // Brief chaos - cards shake
      tl.to(".error-card", {
        x: "+=random(-5, 5)",
        y: "+=random(-5, 5)",
        duration: 0.1,
        repeat: 4,
        yoyo: true,
      });

      // Cards stack into deck
      tl.to(".error-card-0", { x: 0, y: 0, rotation: 0, duration: 0.5, ease: "power3.out" }, "stack");
      tl.to(".error-card-1", { x: 4, y: 4, rotation: 0, duration: 0.5, ease: "power3.out" }, "stack+=0.08");
      tl.to(".error-card-2", { x: 8, y: 8, rotation: 0, duration: 0.5, ease: "power3.out" }, "stack+=0.16");
      tl.to(".error-card-3", { x: 12, y: 12, rotation: 0, duration: 0.5, ease: "power3.out" }, "stack+=0.24");
      tl.to(".error-card-4", { x: 16, y: 16, rotation: 0, duration: 0.5, ease: "power3.out" }, "stack+=0.32");

      // Label appears
      tl.to(".triage-label", { opacity: 1, duration: 0.4 }, "-=0.2");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  const cards = [
    { id: 0, priority: "P1", label: "Critical", count: "847" },
    { id: 1, priority: "P2", label: "High", count: "234" },
    { id: 2, priority: "P2", label: "High", count: "156" },
    { id: 3, priority: "P3", label: "Medium", count: "89" },
    { id: 4, priority: "P3", label: "Medium", count: "42" },
  ];

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="triage-container relative opacity-0">
        {/* Stacked cards */}
        <div className="relative w-52 h-32">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`error-card error-card-${card.id} absolute inset-0 bg-neutral-900 border border-neutral-700 rounded-lg p-3 opacity-0`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded">
                  {card.priority}
                </span>
                <span className="text-neutral-500 text-[10px]">{card.label}</span>
              </div>
              <div className="text-neutral-300 text-lg font-mono font-bold">{card.count}</div>
              <div className="text-neutral-500 text-[10px]">errors</div>
            </div>
          ))}
        </div>

        {/* Label */}
        <div className="triage-label text-center text-neutral-500 text-[11px] mt-8 opacity-0">
          Sorted by business impact
        </div>
      </div>
    </div>
  );
}

// Clean before/after fix visualization
function FixedVisual() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".fix-container", { opacity: 0 });
      gsap.set(".before-card", { opacity: 0, y: 20 });
      gsap.set(".after-card", { opacity: 0, y: 20 });
      gsap.set(".arrow-icon", { opacity: 0, scale: 0 });
      gsap.set(".check-icon", { scale: 0 });

      tl.to(".fix-container", { opacity: 1, duration: 0.3 });

      // Before card slides in
      tl.to(".before-card", {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: "power2.out",
      });

      // Arrow appears
      tl.to(".arrow-icon", {
        opacity: 1,
        scale: 1,
        duration: 0.3,
        ease: "back.out(2)",
      }, "+=0.2");

      // After card slides in
      tl.to(".after-card", {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: "power2.out",
      });

      // Check icon pops
      tl.to(".check-icon", {
        scale: 1,
        duration: 0.3,
        ease: "back.out(2)",
      }, "-=0.1");

      // Before card fades slightly
      tl.to(".before-card", {
        opacity: 0.5,
        duration: 0.3,
      }, "-=0.2");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="fix-container w-full max-w-xs px-2 opacity-0">
        {/* Before */}
        <div className="before-card bg-black/40 border border-white/10 rounded-lg p-4 mb-3 opacity-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white/40 text-[10px] uppercase tracking-wider font-medium">Before</span>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-white/40" />
              <span className="text-white/60 text-xs font-mono font-bold">2,847</span>
            </div>
          </div>
          <div className="bg-black/30 rounded px-2 py-1.5">
            <code className="text-white/50 text-xs font-mono">user.profile.name</code>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center mb-3">
          <div className="arrow-icon w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center opacity-0">
            <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        </div>

        {/* After */}
        <div className="after-card bg-black/50 border border-white/20 rounded-lg p-4 opacity-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white/60 text-[10px] uppercase tracking-wider font-medium">After</span>
            <div className="flex items-center gap-1.5">
              <div className="check-icon w-5 h-5 rounded-full bg-white/20 flex items-center justify-center scale-0">
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-white text-xs font-mono font-bold">0</span>
            </div>
          </div>
          <div className="bg-black/30 rounded px-2 py-1.5">
            <code className="text-white/80 text-xs font-mono">user?.profile?.name</code>
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
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const visualWrapperRef = useRef<HTMLDivElement>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const targetIndexRef = useRef(0);
  const currentIndexRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MIN_STEP_DURATION = 600;

  // Preload all background images on mount
  useEffect(() => {
    const preloadImages = backgroundImages.map((src) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve(); // Still resolve on error to not block
        img.src = src;
      });
    });

    Promise.all(preloadImages).then(() => {
      setImagesLoaded(true);
    });
  }, []);

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

  // Update target when scroll position changes
  useEffect(() => {
    targetIndexRef.current = activeIndex;

    // If not animating, start the animation chain
    if (!isAnimatingRef.current && activeIndex !== currentIndexRef.current) {
      animateStepRef.current?.();
    }
  }, [activeIndex]);

  const animateStepRef = useRef<() => void>(() => {});

  animateStepRef.current = () => {
    const target = targetIndexRef.current;
    const current = currentIndexRef.current;

    if (current === target) {
      isAnimatingRef.current = false;
      return;
    }

    isAnimatingRef.current = true;
    const direction = target > current ? 1 : -1;
    const nextIndex = current + direction;

    if (tweenRef.current) {
      tweenRef.current.kill();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const wrapper = visualWrapperRef.current;
    if (!wrapper) {
      isAnimatingRef.current = false;
      return;
    }

    tweenRef.current = gsap.to(wrapper, {
      opacity: 0,
      scale: 0.95,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => {
        currentIndexRef.current = nextIndex;
        setDisplayIndex(nextIndex);

        gsap.to(wrapper, {
          opacity: 1,
          scale: 1,
          duration: 0.3,
          ease: "power2.out",
          onComplete: () => {
            timeoutRef.current = setTimeout(() => {
              // Check if we need to continue to next step
              if (targetIndexRef.current !== currentIndexRef.current) {
                animateStepRef.current?.();
              } else {
                isAnimatingRef.current = false;
              }
            }, MIN_STEP_DURATION);
          },
        });
      },
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (tweenRef.current) {
        tweenRef.current.kill();
      }
    };
  }, []);

  const ActiveVisual = visualComponents[scrollSteps[displayIndex].visual];

  return (
    <section className="bg-[#0F0D0C] border-t border-neutral-800/5">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
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
                  <div
                    className="relative w-full h-full rounded-xl border border-neutral-900 overflow-hidden transition-all duration-500"
                    style={{
                      backgroundColor: '#1a1512',
                      backgroundImage: imagesLoaded ? `url('${backgroundImages[displayIndex]}')` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    <div
                      ref={visualWrapperRef}
                      className="absolute inset-0 p-4 sm:p-6"
                    >
                      <ActiveVisual key={displayIndex} />
                    </div>
                  </div>
                </div>




                {/* <div className="relative w-full h-full rounded-xl bg-white/[0.02] border border-white/10 overflow-hidden">
                    <div
                      ref={visualWrapperRef}
                      className="absolute inset-0 p-4 sm:p-6"
                    >
                      <ActiveVisual key={displayIndex} />
                    </div>
                  </div>
                </div> */}
              </div>

              {/* Right: Scrolling text sections */}
              <div className="order-2 lg:order-2">
                {scrollSteps.map((step, index) => (
                  <div
                    key={step.id}
                    ref={(el) => {
                      sectionRefs.current[index] = el;
                    }}
                    className={`py-8 lg:py-16 lg:min-h-[380px] flex items-start lg:items-center transition-all duration-300 ${activeIndex === index ? "opacity-100" : "lg:opacity-30"
                      }`}
                  >
                    <div>
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium mb-3 transition-all duration-300 ${activeIndex === index
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
