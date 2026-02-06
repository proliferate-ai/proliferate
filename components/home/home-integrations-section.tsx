"use client";

import Image from "next/image";

const integrations = [
  { name: "GitHub", logo: "https://d1uh4o7rpdqkkl.cloudfront.net/assets/integrations/github.webp" },
  { name: "Sentry", logo: "https://d1uh4o7rpdqkkl.cloudfront.net/assets/integrations/sentry.webp" },
  { name: "Slack", logo: "https://d1uh4o7rpdqkkl.cloudfront.net/assets/integrations/slack.webp" },
  { name: "Linear", logo: "https://d1uh4o7rpdqkkl.cloudfront.net/assets/integrations/linear.svg" },
  { name: "Jira", logo: "https://d1uh4o7rpdqkkl.cloudfront.net/assets/integrations/jira.webp" },
  { name: "Notion", logo: "https://d1uh4o7rpdqkkl.cloudfront.net/assets/integrations/notion.webp" },
];

export function HomeIntegrationsSection() {
  return (
    <section className="w-full py-16 md:py-20 bg-[#0a0a0a]">
      <div className="proliferate-container">
        <div className="flex flex-col w-full max-w-5xl mx-auto gap-8">
          {/* Header */}
          <div className="text-center">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
              Connect your stack
            </h2>
          </div>

          {/* Logos Grid */}
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
            {integrations.map((integration, index) => (
              <div
                key={index}
                className="flex items-center justify-center w-12 h-12 opacity-60 hover:opacity-100 transition-opacity"
              >
                <Image
                  src={integration.logo}
                  alt={integration.name}
                  width={40}
                  height={40}
                  className="object-contain"
                />
              </div>
            ))}
          </div>

          {/* Subtext */}
          <p className="text-center text-white/40 text-sm max-w-lg mx-auto">
            Coding agents do more than code. Connect your internal systems and configure agents for your org.
          </p>
        </div>
      </div>
    </section>
  );
}
