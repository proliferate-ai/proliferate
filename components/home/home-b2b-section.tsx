export function HomeB2BSection() {
  return (
    <section className="py-20 md:py-28 bg-black border-t border-white/5">
      <div className="proliferate-container">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left - Text */}
            <div>
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">
                Built for B2B
              </span>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mt-4 leading-tight">
                When your biggest customer reports a bug, you need answers fast.
              </h2>
              <p className="text-white/40 mt-6 leading-relaxed">
                Which tenant? Which flow? What broke? Proliferate gives you
                instant context so you can fix issues before they email support.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/40 mt-2 shrink-0" />
                  <p className="text-white/50 text-sm">
                    See errors by account, not just aggregate counts
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/40 mt-2 shrink-0" />
                  <p className="text-white/50 text-sm">
                    Know when VIP customers hit issues in real-time
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/40 mt-2 shrink-0" />
                  <p className="text-white/50 text-sm">
                    Understand the full user journey, not just stack traces
                  </p>
                </div>
              </div>
            </div>

            {/* Right - Visual */}
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6">
              <div className="space-y-3">
                {/* VIP Alert */}
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs text-white/40">VIP Alert</span>
                  </div>
                  <p className="text-sm text-white/80 font-medium">
                    Acme Corp hit an error
                  </p>
                  <p className="text-xs text-white/40 mt-1">
                    PDF export timeout during their evaluation
                  </p>
                  <div className="flex gap-2 mt-3">
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-white/50">
                      $50k ARR
                    </span>
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-white/50">
                      Enterprise plan
                    </span>
                  </div>
                </div>

                {/* Healthy accounts */}
                <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-sm text-white/60">TechStart Inc</span>
                    </div>
                    <span className="text-xs text-white/30">Healthy</span>
                  </div>
                </div>

                <div className="bg-white/[0.02] rounded-xl p-4 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-sm text-white/60">StartupXYZ</span>
                    </div>
                    <span className="text-xs text-white/30">Healthy</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
