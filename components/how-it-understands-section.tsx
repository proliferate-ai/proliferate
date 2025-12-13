"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function HowItUnderstandsSection() {
  const [leftTab, setLeftTab] = useState<"errors" | "metrics" | "traces" | "alerts">("errors");
  const [rightTab, setRightTab] = useState<"accounts" | "sessions" | "issues" | "vip">("accounts");

  // Left panel - Sentry-style aggregate view
  const SentryErrorsUI = () => (
    <div className="space-y-2">
      <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500/70" />
            <span className="text-xs font-mono text-zinc-400">TypeError</span>
            <span className="text-xs text-zinc-500">• 2m ago</span>
          </div>
          <span className="text-xs text-zinc-500">423 events</span>
        </div>
        <div className="text-sm text-zinc-300 mb-1">Cannot read property &apos;map&apos; of undefined</div>
        <div className="text-xs text-zinc-600 font-mono">components/ProductList.tsx:45</div>
      </div>

      <div className="bg-zinc-800/20 rounded-lg p-3 border border-zinc-800/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-yellow-500/70" />
            <span className="text-xs font-mono text-zinc-500">Warning</span>
            <span className="text-xs text-zinc-600">• 15m</span>
          </div>
          <span className="text-xs text-zinc-600">87 events</span>
        </div>
        <div className="text-sm text-zinc-400 mb-1">API rate limit approaching</div>
        <div className="text-xs text-zinc-700 font-mono">services/api-client.ts:122</div>
      </div>

      <div className="bg-zinc-800/10 rounded-lg p-3 border border-zinc-900/30 opacity-60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500/50" />
            <span className="text-xs font-mono text-zinc-600">NetworkError</span>
            <span className="text-xs text-zinc-700">• 1h</span>
          </div>
          <span className="text-xs text-zinc-700">156 events</span>
        </div>
        <div className="text-sm text-zinc-500">Connection timeout on /api/checkout</div>
      </div>

      <div className="text-center pt-3">
        <p className="text-xs text-zinc-600 italic">847 total errors today across all users</p>
      </div>
    </div>
  );

  const SentryMetricsUI = () => (
    <div className="space-y-3">
      <div className="bg-zinc-800/20 rounded-lg p-4 border border-zinc-800/30">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-zinc-400">Error Rate</span>
          <span className="text-sm font-mono text-zinc-300">2.3%</span>
        </div>
        <div className="h-2 bg-zinc-900 rounded-full overflow-hidden">
          <div className="h-full bg-zinc-600 rounded-full" style={{ width: "23%" }} />
        </div>
      </div>
      <div className="bg-zinc-800/20 rounded-lg p-4 border border-zinc-800/30">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-zinc-400">P95 Latency</span>
          <span className="text-sm font-mono text-zinc-300">523ms</span>
        </div>
        <div className="h-2 bg-zinc-900 rounded-full overflow-hidden">
          <div className="h-full bg-zinc-600 rounded-full" style={{ width: "52%" }} />
        </div>
      </div>
      <div className="text-center pt-2">
        <p className="text-xs text-zinc-600 italic">Aggregate metrics - no account context</p>
      </div>
    </div>
  );

  const SentryTracesUI = () => (
    <div className="space-y-2">
      <div className="bg-zinc-800/20 rounded-lg p-3 border border-zinc-800/30">
        <div className="text-xs text-zinc-500 mb-2">Trace ID: 8a3f2c91</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-16 text-xs text-zinc-600">nginx</div>
            <div className="flex-1 h-3 bg-zinc-900 rounded overflow-hidden">
              <div className="h-full bg-zinc-700" style={{ width: "100%" }} />
            </div>
            <div className="text-xs text-zinc-600">12ms</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 text-xs text-zinc-600">api</div>
            <div className="flex-1 h-3 bg-zinc-900 rounded overflow-hidden">
              <div className="h-full bg-zinc-700" style={{ width: "60%" }} />
            </div>
            <div className="text-xs text-zinc-600">523ms</div>
          </div>
        </div>
      </div>
      <div className="text-center pt-2">
        <p className="text-xs text-zinc-600 italic">Technical traces without user story</p>
      </div>
    </div>
  );

  const SentryAlertsUI = () => (
    <div className="space-y-2">
      <div className="bg-zinc-800/20 rounded-lg p-3 border border-zinc-800/30">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-red-500/70" />
          <span className="text-xs text-zinc-400">Error rate &gt; 1%</span>
        </div>
        <div className="text-sm text-zinc-300">ALERT: Error threshold exceeded</div>
        <div className="text-xs text-zinc-600 mt-1">Triggered 3x today</div>
      </div>
      <div className="text-center pt-2">
        <p className="text-xs text-zinc-600 italic">Generic thresholds, no customer context</p>
      </div>
    </div>
  );

  // Right panel - Proliferate account-centric view
  const ProliferateAccountsUI = () => (
    <div className="space-y-2">
      <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-zinc-200">Acme Corp</span>
          </div>
          <span className="text-xs text-zinc-400">$50k ARR</span>
        </div>
        <div className="text-xs text-zinc-400 mb-3">3 errors today during their evaluation</div>
        <div className="bg-zinc-900/50 rounded p-2 mb-2">
          <div className="text-xs text-zinc-300 mb-1">Admin tried to export report, PDF generation timed out</div>
          <div className="text-xs text-zinc-600">Session: 2 minutes ago</div>
        </div>
        <Button size="sm" className="w-full h-7 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200">
          Open in Cursor
        </Button>
      </div>

      <div className="bg-zinc-800/20 rounded-lg p-3 border border-zinc-800/30">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-zinc-300">TechStart Inc</span>
          </div>
          <span className="text-xs text-zinc-500">$12k ARR</span>
        </div>
        <div className="text-xs text-zinc-500">Healthy • No issues</div>
      </div>

      <div className="bg-zinc-800/20 rounded-lg p-3 border border-zinc-800/30">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <span className="text-sm font-medium text-zinc-300">BigCo</span>
          </div>
          <span className="text-xs text-zinc-500">$85k ARR</span>
        </div>
        <div className="text-xs text-zinc-500">1 warning • Slow queries</div>
      </div>
    </div>
  );

  const ProliferateSessionsUI = () => (
    <div className="space-y-3">
      <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-zinc-200">Session Summary</span>
          <span className="text-xs text-zinc-500">AI-generated</span>
        </div>
        <div className="bg-zinc-900/50 rounded p-3 mb-2">
          <p className="text-xs text-zinc-300 leading-relaxed">
            &quot;User clicked Export, got a timeout on /api/pdf, retried twice, then left the page.
            They had 47 items in their report. The PDF service was under load from 3 concurrent requests.&quot;
          </p>
        </div>
        <div className="flex gap-2">
          <span className="px-2 py-0.5 bg-zinc-800/50 rounded text-xs text-zinc-400">Acme Corp</span>
          <span className="px-2 py-0.5 bg-zinc-800/50 rounded text-xs text-zinc-400">admin@acme.com</span>
        </div>
      </div>
      <div className="text-xs text-zinc-500 text-center">Full context, not just stack traces</div>
    </div>
  );

  const ProliferateIssuesUI = () => (
    <div className="space-y-2">
      <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-zinc-200">PDF Export Timeout</span>
          <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">Investigating</span>
        </div>
        <div className="text-xs text-zinc-400 mb-2">Affects: Acme Corp, 2 other accounts</div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
          <span>Root cause: Concurrent request limit</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-6 text-xs bg-zinc-700 hover:bg-zinc-600">View Session</Button>
          <Button size="sm" className="h-6 text-xs bg-zinc-700 hover:bg-zinc-600">Fix in Cursor</Button>
        </div>
      </div>
      <div className="bg-zinc-800/20 rounded-lg p-2 border border-zinc-800/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Slow dashboard load</span>
          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">Fixed in main</span>
        </div>
      </div>
    </div>
  );

  const ProliferateVIPUI = () => (
    <div className="space-y-3">
      <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-zinc-400">VIP ALERT • 60s ago</span>
        </div>
        <div className="text-sm font-medium text-zinc-200 mb-2">Acme Corp hit an error</div>
        <div className="bg-zinc-900/50 rounded p-2 text-xs text-zinc-400 mb-2">
          <div><strong className="text-zinc-300">Who:</strong> admin@acme.com</div>
          <div><strong className="text-zinc-300">What:</strong> PDF export timeout</div>
          <div><strong className="text-zinc-300">Where:</strong> /reports/export</div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">via #alerts-vip</span>
          <Button size="sm" className="h-6 text-xs bg-zinc-700 hover:bg-zinc-600">View Session →</Button>
        </div>
      </div>
      <div className="text-xs text-zinc-500 text-center">Instant alerts for accounts that matter</div>
    </div>
  );

  const leftPanels = {
    errors: <SentryErrorsUI />,
    metrics: <SentryMetricsUI />,
    traces: <SentryTracesUI />,
    alerts: <SentryAlertsUI />,
  };

  const rightPanels = {
    accounts: <ProliferateAccountsUI />,
    sessions: <ProliferateSessionsUI />,
    issues: <ProliferateIssuesUI />,
    vip: <ProliferateVIPUI />,
  };

  return (
    <section id="product" className="flex-col pt-16 flex sm:-mt-6 sm:items-center sm:pl-8 sm:pr-8 sm:pt-28 sm:pb-28 bg-black overflow-x-visible">
      <h5 className="hidden sm:block mb-4 text-xs font-semibold tracking-tight text-zinc-400 uppercase">
        How it works
      </h5>
      <h2 className="text-5xl font-bold pl-5 pr-8 mt-2 text-white">One platform. Every account.</h2>
      <p className="text-zinc-400 text-base font-medium pl-5 pr-8 text-left md:text-center w-full max-w-2xl mt-4 sm:pr-0">
        Proliferate captures what&apos;s happening across your product and organizes it by customer—so you see the accounts that matter, not aggregate noise.
      </p>

      <div className="grid-cols-1 grid-rows-[auto] relative grid w-full max-w-5xl mt-16 gap-4 sm:grid-cols-2">
        <div className="pointer-events-none border-b-2 bottom-0 left-[-1.25rem] absolute right-[-1.25rem] border-zinc-700/50 border-dashed z-10" />
        <div className="pointer-events-none border-t-2 left-[-1.25rem] absolute right-[-1.25rem] top-0 border-zinc-700/50 border-dashed z-10" />
        <div className="pointer-events-none border-r-2 absolute top-[-1.25rem] bottom-[-1.25rem] right-[-1.25rem] border-zinc-700/50 border-dashed z-10" />
        <div className="pointer-events-none border-l-2 absolute top-[-1.25rem] bottom-[-1.25rem] left-[-1.25rem] border-zinc-700/50 border-dashed z-10" />

        {/* Left Card - Sentry view */}
        <div className="bg-zinc-800 rounded-2xl flex-col relative flex w-full overflow-hidden">
          <div className="flex-col px-5 pt-10 flex sm:p-6">
            <h4 className="text-xl font-semibold mb-1 sm:mt-0 text-zinc-100">What Sentry shows you</h4>
            <p className="text-zinc-400 text-sm font-medium">
              Aggregate metrics across all users. &quot;You had 847 errors today.&quot; No way to know which customers are affected or how badly.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 px-5 sm:px-6 mt-4 overflow-x-auto flex-nowrap">
            {(["errors", "metrics", "traces", "alerts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  leftTab === tab
                    ? "bg-zinc-700/50 text-zinc-200"
                    : "bg-zinc-800/30 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Panel */}
          <div className="px-5 sm:px-6 py-6 flex-1 min-h-[320px]">
            {leftPanels[leftTab]}
          </div>
        </div>

        {/* Right Card - Proliferate view */}
        <div className="bg-zinc-900 rounded-2xl flex-col relative flex w-full overflow-hidden">
          <div className="flex-col px-5 pt-10 flex sm:p-6">
            <h4 className="text-zinc-50 text-xl font-semibold mb-1 sm:mt-0">What Proliferate shows you</h4>
            <p className="text-zinc-400 text-sm font-medium">
              Health per account. &quot;Acme Corp (your $50k pilot) hit 5 errors during their eval. Here&apos;s exactly what happened.&quot;
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 px-5 sm:px-6 mt-4 overflow-x-auto flex-nowrap">
            {(["accounts", "sessions", "issues", "vip"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  rightTab === tab
                    ? "bg-zinc-700/50 text-zinc-200"
                    : "bg-zinc-800/30 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab === "vip" ? "VIP Alerts" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Panel */}
          <div className="px-5 sm:px-6 py-6 flex-1 min-h-[320px]">
            {rightPanels[rightTab]}
          </div>
        </div>
      </div>
    </section>
  );
}
