"use client";
import { SiteHeader } from "@/components/header";
import { HeroSection } from "@/components/hero-section";
import { BackedBySection } from "@/components/backed-by-section";
import { WhatYouGetSection } from "@/components/what-you-get-section";
import { HowItUnderstandsSection } from "@/components/how-it-understands-section";
import { FeaturesDetailSection } from "@/components/features-detail-section";
import { NewHowItWorks } from "@/components/new-how-it-works";
import { FinalCTASection } from "@/components/final-cta-section";
import { Footer } from "@/components/footer";
import { Suspense } from "react";
import { SearchParamToastWrapper } from "@/components/toasts/SearchParamModal";
import HeroVideo from "@/components/hero-video";

export default function Home() {

  return (
    <>
      <Suspense fallback={null}>
        <SearchParamToastWrapper />
      </Suspense>
      <SiteHeader />
      <main>
        <HeroSection />
        <BackedBySection />
        <WhatYouGetSection />
        <HeroVideo />

        <HowItUnderstandsSection />
        <FeaturesDetailSection />
        <NewHowItWorks />
        <FinalCTASection />
      </main>
      <Footer />
    </>
  )
}