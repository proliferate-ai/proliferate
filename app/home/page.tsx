"use client";

import { Suspense } from "react";
import { SiteHeader } from "@/components/header";
import {
  HomeHeroSection,
  HomePainSection,
  HomeValuePillars,
  HomeHowItWorks,
  HomeB2BSection,
  HomeCTASection,
} from "@/components/home";
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
        <HomeValuePillars />
        <HomeHowItWorks />
        <HomeB2BSection />
        <HomeCTASection />
      </main>
      <Footer />
    </>
  );
}
