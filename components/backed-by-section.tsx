'use client';

import { useEffect, useRef, useState } from 'react';

const investorLogos = [
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/twent.webp', alt: 'Twenty Two VC' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/true.webp', alt: 'True Ventures' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/asylum.webp', alt: 'Asylum Ventures' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/valon.webp', alt: 'Valon' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/ycombinator.webp', alt: 'Y Combinator' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/phosphor.webp', alt: 'Phosphor' },
];

const founderLogos = [
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/ycombinator.webp', alt: 'Y Combinator' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/founders/supabase.webp', alt: 'Supabase' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/founders/resend.webp', alt: 'Resend' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/founders/graphite.webp', alt: 'Graphite' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/founders/rocketmoney.webp', alt: 'Rocket Money' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/founders/gobble.webp', alt: 'Gobble' },
];

const operatorLogos = [
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/openai.webp', alt: 'OpenAI' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/figma.webp', alt: 'Figma' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/dropbox.webp', alt: 'Dropbox' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/harvey.webp', alt: 'Harvey' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/wordware.webp', alt: 'Wordware' },
  { src: 'https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/bland.webp', alt: 'Bland' },
];


function RotatingLogos({ logos, title }: { logos: { src: string; alt: string }[]; title: string }) {
  const [visibleIndices, setVisibleIndices] = useState<number[]>(() => [0, 1, 2, 3]);
  const [isSliding, setIsSliding] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideDurationMs = 700;
  

  useEffect(() => {
    // Reset indices if logos change
    setVisibleIndices([0, 1, 2, 3]);
  }, [logos.length]);

  useEffect(() => {
    const triggerSlide = () => {
      // Start slide
      setIsResetting(false);
      setIsSliding(true);
      // After slide finishes, reset position instantly and rotate items
      timeoutRef.current = setTimeout(() => {
        setIsResetting(true);
        setIsSliding(false);
        setVisibleIndices((prev) => {
          const next = prev.slice(1);
          const last = prev[prev.length - 1];
          const nextIndex = (last + 1) % logos.length;
          next.push(nextIndex);
          return next;
        });
        // Re-enable transitions next tick
        setTimeout(() => {
          setIsResetting(false);
        }, 20);
      }, slideDurationMs);
    };

    intervalRef.current = setInterval(triggerSlide, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [logos.length]);

  // Transition handled via timeout schedule above

  return (
    <div className="flex justify-center">
      <div className="relative">
        <span className="absolute right-full mr-2 text-xs text-gray-500 h-14 top-0 flex items-center whitespace-nowrap">{title}:</span>
        <div className="overflow-hidden w-fit shrink-0" style={{ height: 204 }}>
          <div
            className={`flex flex-col w-fit space-y-3 ${isResetting ? 'transition-none' : 'transition-transform duration-700 ease-out'} ${isSliding ? '-translate-y-[68px]' : 'translate-y-0'}`}
          >
          {visibleIndices.map((logoIdx, idx) => {
            const logo = logos[logoIdx];
            return (
              <div
                key={`row-${idx}`}
                className={`h-14 flex items-center w-fit transform-gpu ${isResetting ? 'transition-none' : 'transition-opacity duration-700 ease-linear'} ${
                  idx === 0
                    ? (isSliding ? 'opacity-40 scale-100' : 'opacity-100 scale-100')
                    : idx === 1
                    ? (isSliding ? 'opacity-100 scale-100' : 'opacity-40 scale-100')
                    : idx === 2
                    ? (isSliding ? 'opacity-40 scale-100' : 'opacity-20 scale-100')
                    : idx === 3
                    ? (isSliding ? 'opacity-20 scale-100' : 'opacity-0 scale-100')
                    : 'opacity-0 scale-100'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo.src}
                  alt={logo.alt}
                  width={1792}
                  height={1024}
                  className="h-14 w-auto object-contain rounded transition-opacity duration-500 ease-out"
                  loading="lazy"
                  style={{ opacity: 0, transitionDelay: `${idx * 80}ms` }}
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement;
                    setTimeout(() => {
                      img.style.opacity = '1';
                    }, 50);
                  }}
                />
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}

function HorizontalRotatingLogos({ logos, title }: { logos: { src: string; alt: string }[]; title: string }) {
  const [visibleIndices, setVisibleIndices] = useState<number[]>(() => [0, 1, 2, 3, 4]);
  const [isSliding, setIsSliding] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideDurationMs = 700;

  useEffect(() => {
    setVisibleIndices([0, 1, 2, 3, 4]);
  }, [logos.length]);

  useEffect(() => {
    const triggerSlide = () => {
      setIsResetting(false);
      setIsSliding(true);
      timeoutRef.current = setTimeout(() => {
        setIsResetting(true);
        setIsSliding(false);
        setVisibleIndices((prev) => {
          const next = prev.slice(1);
          const last = prev[prev.length - 1];
          const nextIndex = (last + 1) % logos.length;
          next.push(nextIndex);
          return next;
        });
        setTimeout(() => {
          setIsResetting(false);
        }, 20);
      }, slideDurationMs);
    };

    intervalRef.current = setInterval(triggerSlide, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [logos.length]);

  return (
    <div className="relative overflow-hidden px-4">
      <h3 className="text-xs text-gray-500 mb-3 text-center">{title}:</h3>
      <div className="relative h-14 overflow-hidden max-w-sm mx-auto">
        <div
          className={`flex items-center ${isResetting ? 'transition-none' : 'transition-transform duration-700 ease-out'} ${isSliding ? '-translate-x-[20%]' : 'translate-x-0'}`}
          style={{ width: '125%', marginLeft: '-12.5%' }}
        >
          {visibleIndices.map((logoIdx, idx) => {
            const logo = logos[logoIdx];
            return (
              <div
                key={`logo-${idx}`}
                className={`w-1/5 flex justify-center px-2 transform-gpu ${isResetting ? 'transition-none' : 'transition-opacity duration-700 ease-linear'} ${
                  idx === 0
                    ? 'opacity-0'
                    : idx === 1
                    ? (isSliding ? 'opacity-0' : 'opacity-60')
                    : idx === 2
                    ? (isSliding ? 'opacity-60' : 'opacity-100')
                    : idx === 3
                    ? (isSliding ? 'opacity-100' : 'opacity-60')
                    : idx === 4
                    ? (isSliding ? 'opacity-60' : 'opacity-0')
                    : 'opacity-0'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo.src}
                  alt={logo.alt}
                  className="h-12 w-auto object-contain rounded transition-opacity duration-500 ease-out"
                  loading="lazy"
                  style={{ opacity: 0, transitionDelay: `${idx * 80}ms` }}
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement;
                    setTimeout(() => {
                      img.style.opacity = '1';
                    }, 50);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function BackedBySection() {
  return (
    <section className="py-16 border-t border-gray-800">
      <div className="keystone-container">
        <h2 className="mb-12 text-sm max-w-6xl mx-auto font-semibold tracking-tight text-gray-400 uppercase text-center">Backed by</h2>
        
        {/* Desktop layout - unchanged */}
        <div className="hidden md:grid grid-cols-3 gap-8 max-w-5xl mx-auto">
          <RotatingLogos logos={investorLogos} title="Investors like" />
          <RotatingLogos logos={founderLogos} title="Founders of" />
          <RotatingLogos logos={operatorLogos} title="Operators from" />
        </div>

        {/* Mobile layout - horizontal animation */}
        <div className="md:hidden space-y-6">
          <HorizontalRotatingLogos logos={founderLogos} title="Founders of" />
          <HorizontalRotatingLogos logos={investorLogos} title="Investors like" />
          <HorizontalRotatingLogos logos={operatorLogos} title="Operators from" />
        </div>
      </div>
    </section>
  );
}