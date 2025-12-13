"use client";

import { Suspense } from "react";
import { SiteHeader } from "@/components/header";
import { HomeHeroSection } from "@/components/home";
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
      </main>
      <Footer />
    </>
  );
}
