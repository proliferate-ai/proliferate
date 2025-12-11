export function NewHowItWorks() {
  const steps = [
    {
      number: "1",
      title: "Install SDK",
      description: "Five lines. Tag sessions by account.",
    },
    {
      number: "2",
      title: "Connect GitHub",
      description: "We learn your codebase and recent changes.",
    },
    {
      number: "3",
      title: "Mark VIP accounts",
      description: "Tell us which customers matter most.",
    },
    {
      number: "4",
      title: "Get alerts",
      description: "Know when VIPs struggle, fix before they email.",
    }
  ];

  return (
    <section id="how-it-works" className="py-16 md:py-20 border-t border-zinc-800">
      <div className="keystone-container  mx-auto px-5">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white text-center mb-3">
          Really easy to start
        </h2>
        <p className="text-center text-zinc-400 mb-8 md:mb-12 text-sm sm:text-base">
          Just four steps. No infrastructure changes. Start seeing account health today.
        </p>
        
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 sm:gap-8 mb-12">
          {steps.map((step, index) => (
            <div key={index} className="flex-1 text-center w-full max-w-[200px] md:max-w-none">
              <div className="flex items-center justify-center mb-3">
                <span className="text-4xl sm:text-5xl font-bold text-neutral-100">{step.number}</span>
              </div>
              <h3 className="font-semibold text-white mb-1 text-sm sm:text-base">{step.title}</h3>
              <p className="text-xs sm:text-sm font-medium text-neutral-400">{step.description}</p>
            </div>
          ))}
        </div>

        {/* <div className="flex justify-center">
          <a 
            href="/docs"
            className="inline-flex items-center justify-center px-6 py-3 text-sm font-medium text-white border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            VIEW DOCUMENTATION
          </a>
        </div> */}
      </div>
    </section>
  );
}