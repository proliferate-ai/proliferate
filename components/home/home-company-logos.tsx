"use client";

const logos = [
  { src: "https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/ycombinator.webp", alt: "Y Combinator" },
  { src: "https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/twent.webp", alt: "Twenty Two VC" },
  { src: "https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/investors/true.webp", alt: "True Ventures" },
  { src: "https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/operators/openai.webp", alt: "OpenAI" },
  { src: "https://d1uh4o7rpdqkkl.cloudfront.net/investors_v2/founders/supabase.webp", alt: "Supabase" },
];

export function HomeCompanyLogos() {
  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-xs text-white/30 uppercase tracking-wider">Backed by</span>
      <div className="flex items-center justify-center gap-8">
        {logos.map((logo, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={logo.src}
            alt={logo.alt}
            className="h-10 cursor-pointer w-auto object-contain bg-white/60 hover:bg-white/90 rounded-xl p-1.5 opacity-70 hover:opacity-100 transition-all"
          />
        ))}
      </div>
    </div>
  );
}
