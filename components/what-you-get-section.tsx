import Image from 'next/image';

export function WhatYouGetSection() {
  const features = [
    {
      number: "001",
      category: "HEALTH",
      title: "See account health at a glance",
      description: "Every account gets a health score based on errors, failed requests, and frustration signals. Red accounts need attention. Green accounts are happy. No more guessing.",
    },
    {
      number: "002",
      category: "CONTEXT",
      title: "Understand what actually happened",
      description: "Not just \"error at line 42\"—see the full story. What the user did, what state they had, what broke, and why. AI summarizes every session so you don't read logs.",
    },
    {
      number: "003",
      category: "FIX",
      title: "Fix it before they notice",
      description: "Click any issue, get full context hydrated in Cursor or Claude Code. Know if it's already fixed in main. Ship the fix before your customer opens a support ticket.",
    }
  ];

  return (
    <div className="flex justify-center items-center w-full rounded-2xl overflow-hidden" style={{ backgroundColor: '#141414' }}>
      <div className="flex flex-col w-full max-w-6xl px-5 sm:px-10 lg:px-20 pt-20 pb-24 gap-16">
        {/* Header Section */}
        <div className="text-white max-w-[45rem]">
          <div className="flex flex-col gap-6">
            <p className="text-xs uppercase tracking-[0.15em] font-medium" style={{ color: 'rgba(255, 255, 255, 0.4)' }}>WHAT YOU GET</p>
            <div className="flex flex-col gap-5">
              <h2 className="text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.1] font-medium tracking-[-0.02em]">
                Your AI maintenance crew
              </h2>
              <p className="text-base leading-[1.6] opacity-60">
                Stop finding out about bugs from angry customer emails. Keystone watches every account 24/7 and tells you the moment something breaks—with full context to fix it.
              </p>
            </div>
          </div>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          {features.map((feature, index) => (
            <div key={index} className="group">
              <div className="flex flex-col justify-between h-full rounded-lg p-6" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                {/* Card Content */}
                <div className="flex flex-col gap-11">
                  <div className="flex flex-col gap-6">
                    {/* Visual Area */}
                    <div className="relative flex items-center justify-center h-48 rounded-lg overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
                      {/* Grid pattern overlay */}
                      <div className="absolute inset-0 opacity-20">
                        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                          <defs>
                            <pattern id={`grid-${index}`} width="40" height="40" patternUnits="userSpaceOnUse">
                              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                            </pattern>
                          </defs>
                          <rect width="100%" height="100%" fill={`url(#grid-${index})`} />
                        </svg>
                      </div>
                      {/* Gradient glow effect */}
                      <div className="absolute inset-0">
                        <div className="w-full h-full bg-[radial-gradient(circle_at_center,_rgba(255,_255,_255,_0.15)_0%,_transparent_70%)]" />
                      </div>
                      {/* Icon/Visual placeholder */}
                      <div className="relative z-10 w-30 h-30 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                        <span className="text-3xl opacity-60">
                          {index === 0 && <Image src={`https://d1uh4o7rpdqkkl.cloudfront.net/assets/logs/sine.webp`} alt={feature.title} className="rounded-full transition-opacity duration-600 ease-out" width={120} height={120} loading="lazy" placeholder="empty" style={{ transitionDelay: '0ms' }} />}

                          {index === 1 && <Image src={`https://d1uh4o7rpdqkkl.cloudfront.net/assets/logs/graph.webp`} alt={feature.title} className="rounded-full transition-opacity duration-600 ease-out" width={120} height={120} loading="lazy" placeholder="empty" style={{ transitionDelay: '150ms' }} />}
                          {index === 2 && <Image src={`https://d1uh4o7rpdqkkl.cloudfront.net/assets/logs/sine.webp`} alt={feature.title} className="rounded-full transition-opacity duration-600 ease-out" width={120} height={120} loading="lazy" placeholder="empty" style={{ transitionDelay: '300ms' }} />}
                          {/* {index === 0 && "🤖"}
                          {index === 1 && "🎯"}
                          {index === 2 && "🔧"} */}
                        </span>
                      </div>
                    </div>

                    {/* Text Content */}
                    <div className="flex flex-col gap-3">
                      <h4 className="text-xl font-medium text-white tracking-[-0.01em]">
                        {feature.title}
                      </h4>
                      <p className="text-sm leading-[1.6] opacity-60">
                        {feature.description}
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex justify-between items-center pt-6 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}>
                    <p className="text-xs uppercase tracking-[0.1em] font-medium opacity-40">
                      {feature.category}
                    </p>
                    <p className="text-xs opacity-30">
                      {feature.number}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}