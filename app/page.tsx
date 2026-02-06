"use client";

import { Suspense } from "react";
import { SiteHeader } from "@/components/header";
import {
  HomeHeroSection,
  HomePainSection,
  HomeStickyScrollSection,
  HomeUseCasesSection,
  HomeIntegrationsSection,
  HomeHowItWorks,
} from "@/components/home";
import { FinalCTASection } from "@/components/final-cta-section";
import { Footer } from "@/components/footer";
import { SearchParamToastWrapper } from "@/components/toasts/SearchParamModal";

export default function HomePage() {
  return (
    <>
      <Suspense fallback={null}>
        <SearchParamToastWrapper />
      </Suspense>
      <SiteHeader />
      <main>
        <HomeHeroSection />
        <HomePainSection />
        <HomeStickyScrollSection />
        <HomeUseCasesSection />
        <HomeIntegrationsSection />
        <HomeHowItWorks />
        <FinalCTASection />
      </main>
      <Footer />
    </>
  );
}
