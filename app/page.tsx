"use client";

import { Suspense } from "react";
import { SiteHeader } from "@/components/header";
import {
  HomeHeroSection,
  HomePainSection,
  HomeStickyScrollSection,
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
        {/* <HomeValuePillars /> */}
        <HomeStickyScrollSection />
        {/* <HomeHowItWorks /> */}
        {/* <HomeB2BSection /> */}
        {/* <HomeCTASection /> */}
        <FinalCTASection />
      </main>
      <Footer />
    </>
  );
}

