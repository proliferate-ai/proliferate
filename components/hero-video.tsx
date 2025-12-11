import Image from 'next/image';

export default function HeroVideo() {
    return (
        <div className="w-full max-w-7xl mx-auto px-4 py-16">
            <div className="bg-neutral-950 rounded-3xl p-4 sm:p-8 md:p-12 overflow-x-auto">
                {/* Cards with labels */}
                <div className="flex items-center justify-start sm:justify-center gap-8 sm:gap-12 md:gap-16 min-w-max sm:min-w-0">
                    {/* Input */}
                    <div className="opacity-0 animate-[fadeIn_0.6s_ease-out_0.1s_forwards]">
                        <div className="bg-neutral-900 rounded-2xl sm:rounded-3xl p-6 sm:p-8 md:p-10 w-[120px] h-[120px] sm:w-[140px] sm:h-[140px] md:w-[150px] md:h-[150px] flex items-center justify-center relative">
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-neutral-800 px-3 py-1 rounded-full w-fit">
                                <div className="w-1.5 h-1.5 rounded-full bg-neutral-500"></div>
                                <span className="text-xs font-medium text-neutral-200">Issue</span>
                            </div>
                            <Image src="/assets/steps/sentry.svg" alt="Sentry" width={48} height={48} className="invert w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12" />

                            {/* Arrow */}
                            <div className="absolute -right-[40px] sm:-right-[60px] md:-right-[60px] top-1/2 -translate-y-1/2">
                                <svg width="48" height="40" viewBox="0 0 48 40" className="sm:w-16 md:w-20 overflow-visible text-neutral-500">
                                    <path d="M8 20 L28 20 L28 10 L40 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="sm:hidden" />
                                    <path d="M8 20 L28 20 L28 10 L52 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden sm:block md:hidden" />
                                    <path d="M8 20 L28 20 L28 10 L60 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden md:block" />
                                    <path d="M36 6 L40 10 L36 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="sm:hidden" />
                                    <path d="M48 6 L52 10 L48 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden sm:block md:hidden" />
                                    <path d="M56 6 L60 10 L56 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden md:block" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Knowledge */}
                    <div className="opacity-0 animate-[fadeIn_0.6s_ease-out_0.3s_forwards]">
                        <div className="bg-neutral-900 rounded-2xl sm:rounded-3xl p-6 sm:p-8 md:p-10 w-[120px] h-[120px] sm:w-[140px] sm:h-[140px] md:w-[150px] md:h-[150px] flex items-center justify-center relative">
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-neutral-800 px-3 py-1 rounded-full w-fit">
                                <div className="w-1.5 h-1.5 rounded-full bg-neutral-500"></div>
                                <span className="text-xs font-medium text-neutral-200">Team</span>
                            </div>
                            <Image src="https://d1uh4o7rpdqkkl.cloudfront.net/assets/steps/slack.webp" alt="Slack" width={48} height={48} className="grayscale w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12" />

                            {/* Arrow */}
                            <div className="absolute -right-[40px] sm:-right-[60px] md:-right-[60px] top-1/2 -translate-y-1/2">
                                <svg width="48" height="40" viewBox="0 0 48 40" className="sm:w-16 md:w-20 overflow-visible text-neutral-500">
                                    <path d="M8 20 L28 20 L28 10 L40 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="sm:hidden" />
                                    <path d="M8 20 L28 20 L28 10 L52 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden sm:block md:hidden" />
                                    <path d="M8 20 L28 20 L28 10 L60 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden md:block" />
                                    <path d="M36 6 L40 10 L36 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="sm:hidden" />
                                    <path d="M48 6 L52 10 L48 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden sm:block md:hidden" />
                                    <path d="M56 6 L60 10 L56 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden md:block" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* LLM */}
                    <div className="opacity-0 animate-[fadeIn_0.6s_ease-out_0.5s_forwards]">
                        <div className="bg-neutral-900 rounded-2xl sm:rounded-3xl p-6 sm:p-8 md:p-10 w-[120px] h-[120px] sm:w-[140px] sm:h-[140px] md:w-[150px] md:h-[150px] flex items-center justify-center relative">
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-neutral-800 px-3 py-1 rounded-full w-fit">
                                <div className="w-1.5 h-1.5 rounded-full bg-neutral-500"></div>
                                <span className="text-xs font-medium text-neutral-200">Codebase</span>
                            </div>
                            <div className="relative">
                                <Image src="/assets/steps/github.svg" alt="PR" width={48} height={48} className="text-neutral-300 w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12" />
                                <div className="absolute -top-1 -right-1">
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-neutral-500">
                                        <path d="M5 1V9M1 5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </div>
                            </div>

                            {/* Arrow */}
                            <div className="absolute -right-[40px] sm:-right-[60px] md:-right-[60px] top-1/2 -translate-y-1/2">
                                <svg width="48" height="40" viewBox="0 0 48 40" className="sm:w-16 md:w-20 overflow-visible text-neutral-500">
                                    <path d="M8 20 L28 20 L28 10 L40 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="sm:hidden" />
                                    <path d="M8 20 L28 20 L28 10 L52 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden sm:block md:hidden" />
                                    <path d="M8 20 L28 20 L28 10 L60 10"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden md:block" />
                                    <path d="M36 6 L40 10 L36 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="sm:hidden" />
                                    <path d="M48 6 L52 10 L48 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden sm:block md:hidden" />
                                    <path d="M56 6 L60 10 L56 14"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        fill="none"
                                        className="hidden md:block" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Output */}
                    <div className="opacity-0 animate-[fadeIn_0.6s_ease-out_0.7s_forwards]">
                        <div className="bg-neutral-900 rounded-2xl sm:rounded-3xl p-6 sm:p-8 md:p-10 w-[120px] h-[120px] sm:w-[140px] sm:h-[140px] md:w-[150px] md:h-[150px] flex items-center justify-center relative">
                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-neutral-800 px-3 py-1 rounded-full w-fit">
                                <div className="w-1.5 h-1.5 rounded-full bg-neutral-500"></div>
                                <span className="text-xs font-medium text-neutral-200">Fix</span>
                            </div>
                            <Image src="https://d1uh4o7rpdqkkl.cloudfront.net/assets/steps/claude.webp" alt="PR" width={48} height={48} className="text-neutral-300 grayscale w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}