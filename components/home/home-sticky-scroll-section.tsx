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

// Dashboard cracks, then action card fixes it
function ActionVisual() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFixed, setIsFixed] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".dashboard-mock", { opacity: 0, scale: 0.95 });
      gsap.set(".dashboard-line", { scaleX: 0, transformOrigin: "left" });
      gsap.set(".action-card", { opacity: 0, y: 20, scale: 0.95 });
      gsap.set(".action-inner", { opacity: 0 });
      gsap.set(".dash-crack-line", { opacity: 0 });
      gsap.set(".dash-shard", { opacity: 0 });

      // Dashboard appears
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

      // Dashboard cracks!
      tl.to(".dashboard-mock", {
        x: "+=2",
        duration: 0.05,
        repeat: 3,
        yoyo: true,
      }, "+=0.3");

      tl.to(".dash-crack-line", {
        opacity: 1,
        duration: 0.1,
        stagger: 0.02,
      });

      // Shards break off and scatter
      tl.to(".dash-shard", {
        opacity: 1,
        duration: 0.05,
      });

      tl.to(".dash-shard-0", { x: -80, y: 120, rotation: -45, duration: 0.6, ease: "power2.in" }, "shatter");
      tl.to(".dash-shard-1", { x: 60, y: 100, rotation: 30, duration: 0.55, ease: "power2.in" }, "shatter");
      tl.to(".dash-shard-2", { x: -50, y: 80, rotation: -60, duration: 0.5, ease: "power2.in" }, "shatter");
      tl.to(".dash-shard-3", { x: 70, y: 130, rotation: 50, duration: 0.65, ease: "power2.in" }, "shatter");
      tl.to(".dash-shard-4", { x: -30, y: 110, rotation: -25, duration: 0.55, ease: "power2.in" }, "shatter");
      tl.to(".dash-shard-5", { x: 40, y: 90, rotation: 40, duration: 0.5, ease: "power2.in" }, "shatter");

      // Dashboard fades/blurs
      tl.to(".dashboard-mock", {
        opacity: 0.15,
        scale: 0.92,
        filter: "blur(3px)",
        duration: 0.3,
      }, "shatter+=0.1");

      // Action card appears
      tl.to(".action-card", {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.4,
        ease: "back.out(1.5)",
      }, "-=0.1");

      tl.to(".action-inner", {
        opacity: 1,
        duration: 0.25,
        stagger: 0.06,
        ease: "power2.out",
      }, "-=0.1");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  const handleApplyFix = () => {
    if (isFixed) return;
    setIsFixed(true);

    gsap.context(() => {
      const tl = gsap.timeline();

      // Button shows success
      tl.to(".apply-btn", {
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        color: "#404040",
        duration: 0.2,
      });

      // Shards fly back together
      tl.to(".dash-shard-0", { x: 0, y: 0, rotation: 0, duration: 0.4, ease: "power2.out" }, "reassemble");
      tl.to(".dash-shard-1", { x: 0, y: 0, rotation: 0, duration: 0.35, ease: "power2.out" }, "reassemble");
      tl.to(".dash-shard-2", { x: 0, y: 0, rotation: 0, duration: 0.4, ease: "power2.out" }, "reassemble");
      tl.to(".dash-shard-3", { x: 0, y: 0, rotation: 0, duration: 0.45, ease: "power2.out" }, "reassemble");
      tl.to(".dash-shard-4", { x: 0, y: 0, rotation: 0, duration: 0.35, ease: "power2.out" }, "reassemble");
      tl.to(".dash-shard-5", { x: 0, y: 0, rotation: 0, duration: 0.4, ease: "power2.out" }, "reassemble");

      // Hide shards and cracks
      tl.to(".dash-shard", { opacity: 0, duration: 0.2 });
      tl.to(".dash-crack-line", { opacity: 0, duration: 0.2 }, "-=0.2");

      // Dashboard comes back
      tl.to(".dashboard-mock", {
        opacity: 1,
        scale: 1,
        filter: "blur(0px)",
        duration: 0.4,
        ease: "power2.out",
      }, "-=0.2");

      // Flash of success
      tl.to(".dashboard-mock", {
        borderColor: "rgba(74, 222, 128, 0.5)",
        duration: 0.2,
      });

      tl.to(".dashboard-mock", {
        borderColor: "rgba(248, 113, 113, 0.2)",
        duration: 0.5,
        delay: 0.5,
      });

    }, containerRef);
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {/* Dashboard mockup */}
      <div ref={dashboardRef} className="dashboard-mock absolute inset-2 sm:inset-4 bg-red-950/30 rounded-lg border border-red-500/20 p-3 opacity-0">
        {/* Crack lines on dashboard */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path className="dash-crack-line opacity-0" d="M45 0 L48 20 L42 35 L50 50 L44 70 L48 85 L45 100" stroke="white" strokeWidth="0.8" fill="none" />
          <path className="dash-crack-line opacity-0" d="M48 20 L30 25 L20 20" stroke="white" strokeWidth="0.6" fill="none" />
          <path className="dash-crack-line opacity-0" d="M42 35 L60 40 L75 35" stroke="white" strokeWidth="0.6" fill="none" />
          <path className="dash-crack-line opacity-0" d="M50 50 L35 60 L25 55" stroke="white" strokeWidth="0.5" fill="none" />
          <path className="dash-crack-line opacity-0" d="M44 70 L65 75 L80 70" stroke="white" strokeWidth="0.5" fill="none" />
        </svg>

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

      {/* Glass shards that break off from dashboard */}
      <div className="dash-shard dash-shard-0 absolute top-8 left-8 w-12 h-16 bg-red-950/40 border border-red-400/30 rounded opacity-0" style={{ clipPath: "polygon(0 0, 100% 10%, 90% 100%, 5% 85%)" }} />
      <div className="dash-shard dash-shard-1 absolute top-12 right-12 w-14 h-12 bg-red-950/35 border border-red-400/25 rounded opacity-0" style={{ clipPath: "polygon(10% 0, 100% 5%, 95% 100%, 0 90%)" }} />
      <div className="dash-shard dash-shard-2 absolute top-1/3 left-12 w-10 h-14 bg-red-950/45 border border-red-400/35 rounded opacity-0" style={{ clipPath: "polygon(5% 0, 95% 15%, 100% 100%, 0 85%)" }} />
      <div className="dash-shard dash-shard-3 absolute bottom-1/3 right-8 w-12 h-10 bg-red-950/40 border border-red-400/30 rounded opacity-0" style={{ clipPath: "polygon(0 10%, 100% 0, 90% 100%, 10% 95%)" }} />
      <div className="dash-shard dash-shard-4 absolute top-1/2 left-1/4 w-8 h-12 bg-red-950/35 border border-red-400/25 rounded opacity-0" style={{ clipPath: "polygon(15% 0, 100% 20%, 85% 100%, 0 80%)" }} />
      <div className="dash-shard dash-shard-5 absolute top-1/3 right-1/4 w-10 h-8 bg-red-950/40 border border-red-400/30 rounded opacity-0" style={{ clipPath: "polygon(0 15%, 100% 0, 95% 100%, 10% 90%)" }} />

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
          <button
            onClick={handleApplyFix}
            disabled={isFixed}
            className="apply-btn w-full bg-red-400 hover:bg-red-300 disabled:bg-white/90 text-red-950 disabled:text-neutral-700 text-xs font-medium py-1.5 px-3 rounded-md text-center cursor-pointer disabled:cursor-default transition-colors"
          >
            {isFixed ? "Fixed!" : "Apply fix"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Orbital rings with varied shapes
function SetupVisual() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tl = gsap.timeline();
    const ctx = gsap.context(() => {
      gsap.set(".setup-container", { opacity: 0 });
      gsap.set(".ring", { scale: 0, opacity: 0, rotation: 0 });
      gsap.set(".center-core", { scale: 0 });
      gsap.set(".setup-label", { opacity: 0, y: 10 });
      gsap.set(".ripple", { scale: 0, opacity: 0 });

      tl.to(".setup-container", { opacity: 1, duration: 0.3 });

      // Rings expand outward
      tl.to(".ring-1", { scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" });
      tl.to(".ring-2", { scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.3");
      tl.to(".ring-3", { scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.3");

      // Rings rotate at different speeds
      tl.to(".ring-1", { rotation: 360, duration: 8, ease: "none", repeat: -1 }, "-=0.5");
      tl.to(".ring-2", { rotation: -360, duration: 12, ease: "none", repeat: -1 }, "-=8");
      tl.to(".ring-3", { rotation: 360, duration: 16, ease: "none", repeat: -1 }, "-=12");

      // Center core
      tl.to(".center-core", { scale: 1, duration: 0.4, ease: "back.out(2)" }, "-=15");

      // Label
      tl.to(".setup-label", { opacity: 1, y: 0, duration: 0.4 }, "-=14.5");

    }, containerRef);

    return () => ctx.revert();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ringsRef.current) return;
    const rect = ringsRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const distance = Math.sqrt(x * x + y * y);
    const maxDistance = rect.width / 2;

    // Only trigger ripple when moving through the rings area
    if (distance > 20 && distance < maxDistance) {
      const ripples = containerRef.current?.querySelectorAll('.ripple');
      ripples?.forEach((ripple, i) => {
        gsap.to(ripple, {
          scale: 1 + (i * 0.3),
          opacity: 0.3 - (i * 0.1),
          duration: 0.4,
          ease: "power2.out",
        });
        gsap.to(ripple, {
          scale: 1.5 + (i * 0.3),
          opacity: 0,
          duration: 0.6,
          delay: 0.1,
          ease: "power2.out",
        });
      });
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="setup-container relative opacity-0">
        <div ref={ringsRef} onMouseMove={handleMouseMove} className="relative w-48 h-48 cursor-pointer">
          {/* Ripple effects */}
          <div className="ripple absolute inset-0 rounded-full border-2 border-blue-400/50 pointer-events-none" />
          <div className="ripple absolute inset-6 rounded-full border-2 border-blue-400/40 pointer-events-none" />
          <div className="ripple absolute inset-12 rounded-full border-2 border-blue-400/30 pointer-events-none" />

          {/* Outer ring */}
          <div className="ring ring-3 absolute inset-0 rounded-full border-2 border-blue-500/40 opacity-0">
            {/* File icon */}
            <svg className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.4">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" />
              <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" />
            </svg>
            {/* Git branch */}
            <svg className="absolute top-1/4 -right-3 w-6 h-6 text-blue-700" viewBox="0 0 24 24" fill="none">
              <circle cx="6" cy="6" r="2.5" fill="currentColor" fillOpacity="0.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="18" r="2.5" fill="currentColor" fillOpacity="0.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="6" cy="18" r="2.5" fill="currentColor" fillOpacity="0.5" stroke="currentColor" strokeWidth="2" />
              <path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3H9" stroke="currentColor" strokeWidth="2" />
            </svg>
            {/* Terminal */}
            <svg className="absolute bottom-6 -left-3 w-6 h-6 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.35">
              <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M6 9l3 3-3 3M12 15h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          {/* Middle ring */}
          <div className="ring ring-2 absolute inset-6 rounded-full border-2 border-dashed border-blue-700/50 opacity-0">
            {/* Bug icon */}
            <svg className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.45">
              <ellipse cx="12" cy="14" rx="5" ry="6" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8V6M8 9L5 7M16 9l3-2M5 12H2M22 12h-3M5 17l-2 2M19 17l2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {/* Database */}
            <svg className="absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.4">
              <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="2" />
              <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" stroke="currentColor" strokeWidth="2" />
              <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" stroke="currentColor" strokeWidth="2" />
            </svg>
            {/* Code brackets */}
            <svg className="absolute -bottom-2 left-1/4 w-5 h-5 text-blue-700" viewBox="0 0 24 24" fill="none">
              <path d="M8 4L3 12l5 8M16 4l5 8-5 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Inner ring */}
          <div className="ring ring-1 absolute inset-12 rounded-full border-2 border-blue-700/60 opacity-0">
            {/* Checkmark */}
            <svg className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-5 h-5 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.5">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* Warning */}
            <svg className="absolute top-1/2 -left-2.5 -translate-y-1/2 w-5 h-5 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.45">
              <path d="M12 3L2 21h20L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12 10v4M12 17v.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          {/* Center core - Proliferate logo style */}
          <div className="center-core absolute inset-0 flex items-center justify-center scale-0">
            <div className="w-14 h-14 rounded-xl bg-blue-500/35 border-2 border-blue-700 flex items-center justify-center">
              <svg className="w-7 h-7 text-blue-700" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        {/* Label */}
        <div className="setup-label absolute -bottom-8 left-1/2 -translate-x-1/2 text-blue-300/70 text-[11px] whitespace-nowrap opacity-0">
          Connecting to your codebase
        </div>
      </div>
    </div>
  );
}

// Minimalist animated error type icons
function AuthErrorIcon() {
  return (
    <div className="error-icon relative w-7 h-7">
      <svg className="w-7 h-7 text-red-400" viewBox="0 0 24 24" fill="none">
        <rect x="6" y="11" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div className="icon-pulse absolute inset-0 rounded-full border border-red-400/50" />
    </div>
  );
}

function InfraErrorIcon() {
  return (
    <div className="error-icon relative w-7 h-7">
      <svg className="w-7 h-7 text-orange-400" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="4" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="5" y="14" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="7" r="1" fill="currentColor" />
        <circle cx="8" cy="17" r="1" fill="currentColor" opacity="0.4" />
      </svg>
      <div className="icon-pulse absolute inset-0 rounded-full border border-orange-400/50" />
    </div>
  );
}

function DataErrorIcon() {
  return (
    <div className="error-icon relative w-7 h-7">
      <svg className="w-7 h-7 text-yellow-400" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="6" rx="6" ry="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 6v12c0 1.1 2.69 2 6 2s6-.9 6-2V6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 12c0 1.1 2.69 2 6 2s6-.9 6-2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div className="icon-pulse absolute inset-0 rounded-full border border-yellow-400/50" />
    </div>
  );
}

function NetworkErrorIcon() {
  return (
    <div className="error-icon relative w-7 h-7">
      <svg className="w-7 h-7 text-purple-400" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="18" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6" cy="18" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L7.5 7.5M13.5 10.5l3-3M10.5 13.5L7.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
      </svg>
      <div className="icon-pulse absolute inset-0 rounded-full border border-purple-400/50" />
    </div>
  );
}

function RuntimeErrorIcon() {
  return (
    <div className="error-icon relative w-7 h-7">
      <svg className="w-7 h-7 text-cyan-400" viewBox="0 0 24 24" fill="none">
        <path d="M8 5L4 12l4 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 5l4 7-4 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div className="icon-pulse absolute inset-0 rounded-full border border-cyan-400/50" />
    </div>
  );
}

const errorIcons = [AuthErrorIcon, InfraErrorIcon, DataErrorIcon, NetworkErrorIcon, RuntimeErrorIcon];

// Scattered errors organize into card deck
function TriageVisual() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dismissedCards, setDismissedCards] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const currentCardRef = useRef<HTMLDivElement | null>(null);

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
      gsap.set(".icon-pulse", { scale: 0.8, opacity: 0 });

      tl.to(".triage-container", { opacity: 1, duration: 0.3 });

      // Cards appear scattered
      tl.to(".error-card", {
        opacity: 1,
        duration: 0.3,
        stagger: 0.08,
      });

      // Icon pulse animation
      tl.to(".icon-pulse", {
        scale: 1.4,
        opacity: 0.8,
        duration: 0.3,
        stagger: 0.06,
        ease: "power2.out",
      }, "-=0.2");

      tl.to(".icon-pulse", {
        scale: 1.8,
        opacity: 0,
        duration: 0.4,
        stagger: 0.06,
        ease: "power2.out",
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

  const handlePointerDown = (e: React.PointerEvent, cardId: number, cardEl: HTMLDivElement) => {
    if (dismissedCards.includes(cardId)) return;
    setIsDragging(true);
    dragStartX.current = e.clientX;
    currentCardRef.current = cardEl;
    cardEl.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent, cardId: number) => {
    if (!isDragging || !currentCardRef.current || dismissedCards.includes(cardId)) return;
    const deltaX = e.clientX - dragStartX.current;
    const rotation = deltaX * 0.1;
    gsap.set(currentCardRef.current, { x: deltaX, rotation });
  };

  const handlePointerUp = (e: React.PointerEvent, cardId: number) => {
    if (!isDragging || !currentCardRef.current) return;
    setIsDragging(false);
    const deltaX = e.clientX - dragStartX.current;
    const card = currentCardRef.current;

    if (Math.abs(deltaX) > 80) {
      // Swipe away
      const direction = deltaX > 0 ? 1 : -1;
      gsap.to(card, {
        x: direction * 300,
        rotation: direction * 30,
        opacity: 0,
        duration: 0.3,
        ease: "power2.in",
        onComplete: () => {
          setDismissedCards(prev => [...prev, cardId]);
        }
      });
    } else {
      // Snap back
      gsap.to(card, {
        x: cardId * 4,
        rotation: 0,
        duration: 0.3,
        ease: "back.out(1.5)",
      });
    }
    currentCardRef.current = null;
  };

  const cards = [
    { id: 0, priority: "P0", label: "Auth", count: "847" },
    { id: 1, priority: "P1", label: "Infra", count: "234" },
    { id: 2, priority: "P1", label: "Data", count: "156" },
    { id: 3, priority: "P2", label: "Network", count: "89" },
    { id: 4, priority: "P2", label: "Runtime", count: "42" },
  ];

  // Get the top visible card (first non-dismissed)
  const topCardId = cards.find(c => !dismissedCards.includes(c.id))?.id ?? -1;

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <div className="triage-container relative opacity-0">
        {/* Stacked cards */}
        <div className="relative w-56 h-36">
          {cards.map((card) => {
            const IconComponent = errorIcons[card.id];
            const isTopCard = card.id === topCardId;
            const isDismissed = dismissedCards.includes(card.id);
            // Top card gets highest z-index, dismissed cards get lowest
            const zIndex = isDismissed ? 0 : (isTopCard ? 20 : (10 - card.id));
            return (
              <div
                key={card.id}
                onPointerDown={(e) => isTopCard && handlePointerDown(e, card.id, e.currentTarget)}
                onPointerMove={(e) => isTopCard && handlePointerMove(e, card.id)}
                onPointerUp={(e) => isTopCard && handlePointerUp(e, card.id)}
                className={`error-card error-card-${card.id} absolute inset-0 bg-neutral-900 border border-neutral-700 rounded-lg p-3 opacity-0 ${isTopCard && !isDismissed ? 'cursor-grab active:cursor-grabbing' : ''} ${isDismissed ? 'pointer-events-none' : ''}`}
                style={{ touchAction: 'none', zIndex }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono font-bold text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded">
                        {card.priority}
                      </span>
                      <span className="text-neutral-500 text-[10px]">{card.label}</span>
                    </div>
                    <div className="text-neutral-300 text-lg font-mono font-bold">{card.count}</div>
                    <div className="text-neutral-500 text-[10px]">errors</div>
                  </div>
                  <IconComponent />
                </div>
              </div>
            );
          })}
        </div>

        {/* Label */}
        <div className="triage-label text-center text-neutral-500 text-[11px] mt-8 opacity-0">
          {dismissedCards.length > 0 ? 'Swipe to dismiss' : 'Sorted by business impact'}
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
