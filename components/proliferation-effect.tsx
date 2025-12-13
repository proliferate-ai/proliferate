"use client";

import React, { useEffect, useRef } from "react";

// --- Types ---
interface Wave {
  x: number;
  y: number;
  time: number;
  strength: number;
  id: number;
}

interface Boat {
  y: number;
  angle: number;
  targetY: number;
  targetAngle: number;
}

export default function PoeticRiver() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Animation State ---
  const waves = useRef<Wave[]>([]);
  const boat = useRef<Boat>({ y: 0, angle: 0, targetY: 0, targetAngle: 0 });
  const mouse = useRef({ x: -1000, y: -1000, active: false });
  const time = useRef(0);
  const rafId = useRef<number>(0);

  // --- Configuration ---
  const C = {
    lineCount: 40,        // How many water lines to draw
    lineSpacing: 14,      // Vertical space between lines
    amplitude: 8,         // Height of the idle river waves
    wavelength: 0.006,    // Width of the idle river waves
    flowSpeed: 0.02,      // How fast the river moves
    boatSpeed: 0.03,      // Inertia: lower = heavier boat
    rippleSpeed: 0.8,     // Expansion speed of the rings
    rippleDrift: 1.5,     // How fast ripples move downstream
    boatXRatio: 0.5,      // Position of boat (0.5 = center)
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // --- Physics Engine: Water Surface Height ---
    // Calculates the Z-height of the water at any given (x, y) point
    // considering both the natural river flow and active ripples
    const getWaterHeight = (x: number, yBase: number, t: number) => {
      // 1. Natural Flow (The River)
      // We mix two sine waves to create a non-repetitive organic surface
      let yOffset = Math.sin(x * C.wavelength + t) * C.amplitude 
                  + Math.cos(x * C.wavelength * 0.5 - t * 0.5) * (C.amplitude * 0.5);

      // 2. Interaction Ripples (The Disturbance)
      for (const w of waves.current) {
        // Advection: The ripple center moves downstream with the current
        const age = t - w.time;
        const drift = age * C.rippleDrift * 60; 
        const waveCenterX = w.x - drift; 
        
        const dx = x - waveCenterX;
        const dy = yBase - w.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Ripple Physics: A decaying sine ring
        const radius = age * C.rippleSpeed * 60;
        const waveWidth = 100; // Thickness of the ring
        
        // Optimization: Only calculate if we are near the ring
        if (Math.abs(dist - radius) < waveWidth) {
           const strength = Math.max(0, 1 - age * 0.4); // Fades over time
           const rippleH = Math.sin(dist * 0.1 - age * 8) * w.strength * strength;
           
           // Dampen based on distance from center (Splash gets weaker as it spreads)
           const dampening = Math.max(0, 1 - dist / 800);
           yOffset += rippleH * dampening;
        }
      }
      return yBase + yOffset;
    };

    // --- Renderer: The Boat ---
    const drawBoat = (centerX: number, centerY: number, angle: number) => {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle);

        // Minimalist Paper Boat Style
        const scale = 0.8;
        ctx.scale(scale, scale);

        // Reflection (Inverted, low opacity)
        ctx.save();
        ctx.scale(1, -0.5);
        ctx.translate(0, -30);
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.moveTo(-35, -10);
        ctx.lineTo(35, -10);
        ctx.lineTo(20, 15);
        ctx.lineTo(-20, 15);
        ctx.fill();
        ctx.restore();

        // Hull
        ctx.fillStyle = "#F5F5F5";
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        
        ctx.beginPath();
        ctx.moveTo(-35, -10);
        ctx.lineTo(35, -10);
        ctx.lineTo(20, 15);
        ctx.lineTo(-20, 15);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Front Sail
        ctx.fillStyle = "#E0E0E0";
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(0, -55);
        ctx.lineTo(28, -10);
        ctx.fill();
        ctx.stroke();

        // Back Sail
        ctx.fillStyle = "#D4D4D4";
        ctx.beginPath();
        ctx.moveTo(-5, -10);
        ctx.lineTo(-2, -40);
        ctx.lineTo(-25, -10);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    };

    // --- Main Loop ---
    const animate = () => {
      if (!canvas || !containerRef.current) return;
      
      time.current += C.flowSpeed;
      const w = canvas.width;
      const h = canvas.height;

      // 1. Background (Deep River Night)
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#09090b"); 
      gradient.addColorStop(1, "#18181b"); 
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // 2. Cleanup Old Waves
      waves.current = waves.current.filter(wave => time.current - wave.time < 5);

      // 3. Draw River Lines
      // We determine where the boat sits in the Z-stack
      const boatBaseY = h * 0.55; 
      const boatLineIndex = Math.floor((boatBaseY - h * 0.2) / C.lineSpacing);
      const boatX = w * C.boatXRatio;

      ctx.lineWidth = 1.5;
      
      for (let i = 0; i < C.lineCount; i++) {
        // Perspective: Lines are closer at top, creating depth
        const progress = i / C.lineCount;
        const yBase = (h * 0.3) + (i * C.lineSpacing) + (progress * progress * 40);
        
        // Depth Fade: Further lines are dimmer
        const alpha = Math.min(1, Math.max(0.1, progress * 0.8));
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        
        ctx.beginPath();
        let first = true;
        
        // Draw the line vertex by vertex
        for (let x = -20; x <= w + 20; x += 10) {
            const y = getWaterHeight(x, yBase, time.current);
            if (first) { ctx.moveTo(x, y); first = false; }
            else { ctx.lineTo(x, y); }
        }
        ctx.stroke();

        // --- Boat Logic ---
        // If we just drew the line "behind" the boat, it's time to draw the boat
        // so it sits correctly in the 3D stack
        if (i === boatLineIndex) {
            // Physics: Sample water at Bow (-20) and Stern (+20)
            const yBow = getWaterHeight(boatX + 20, yBase, time.current);
            const yStern = getWaterHeight(boatX - 20, yBase, time.current);
            
            const targetY = (yBow + yStern) / 2;
            const targetAngle = Math.atan2(yBow - yStern, 40); // 40 is boat length

            // Lerp for heavy fluid feel
            boat.current.y += (targetY - boat.current.y) * C.boatSpeed;
            boat.current.angle += (targetAngle - boat.current.angle) * C.boatSpeed;

            // Draw
            drawBoat(boatX, boat.current.y - 5, boat.current.angle);
        }
      }
      
      // 4. Mouse Logic
      if (mouse.current.active) {
         // Create small ripples when moving fast
         if (Math.random() > 0.6) {
             waves.current.push({
                 x: mouse.current.x,
                 y: mouse.current.y,
                 time: time.current,
                 strength: 8,
                 id: Math.random()
             });
         }
      }

      rafId.current = requestAnimationFrame(animate);
    };

    // --- Init & Events ---
    const handleResize = () => {
        if (!containerRef.current || !canvas) return;
        const rect = containerRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    };
    
    window.addEventListener("resize", handleResize);
    handleResize();
    animate();

    return () => {
        window.removeEventListener("resize", handleResize);
        cancelAnimationFrame(rafId.current);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouse.current.x = e.clientX - rect.left;
      mouse.current.y = e.clientY - rect.top;
      mouse.current.active = true;
  };

  const handleMouseLeave = () => { mouse.current.active = false; };
  
  const handleClick = (e: React.MouseEvent) => {
     if (!containerRef.current) return;
     const rect = containerRef.current.getBoundingClientRect();
     // Large Splash
     waves.current.push({
         x: e.clientX - rect.left,
         y: e.clientY - rect.top,
         time: time.current,
         strength: 25,
         id: Math.random()
     });
  };

  return (
    <div 
        ref={containerRef}
        className="relative w-full h-[500px] bg-neutral-950 overflow-hidden rounded-xl border border-white/10 shadow-2xl cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
    >
        <canvas ref={canvasRef} className="block w-full h-full" />
        
        {/* Poetic Overlay */}
        <div className="absolute top-8 left-8 pointer-events-none select-none mix-blend-difference">
            <h2 className="text-white/90 font-serif text-2xl italic tracking-wide">The River</h2>
            <div className="w-12 h-px bg-white/50 my-2" />
            <p className="text-white/60 text-[10px] uppercase tracking-[0.25em]">
                Flow &bull; Drift &bull; React
            </p>
        </div>
    </div>
  );
}