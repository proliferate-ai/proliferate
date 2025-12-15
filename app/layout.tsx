import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import "../styles/sonner.css";
import { Toaster } from "sonner";
import { PostHogProviderWrapper } from "../components/PostHogProviderWrapper";
import { Analytics } from "@vercel/analytics/next";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Proliferate | Account-Level Bug Intelligence for B2B",
  description: "The B2B observability platform that shows you exactly what's happening inside each account. See who's struggling, why, and fix it before they email you.",
  keywords: ["B2B observability", "account health", "customer success", "bug detection", "session replay", "AI debugging", "developer tools", "VIP alerts", "customer intelligence"],
  authors: [{ name: "Proliferate" }],
  creator: "Proliferate",
  publisher: "Proliferate",
  metadataBase: new URL("https://withProliferate.com"),

  // Open Graph meta tags for social media sharing
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://withProliferate.com",
    title: "Proliferate | Know When Your Biggest Customers Are Struggling",
    description: "The B2B observability platform that shows you exactly what's happening inside each account. See who's struggling, why, and fix it before they email you.",
    siteName: "Proliferate",
    images: [
      {
        url: "https://d1uh4o7rpdqkkl.cloudfront.net/og.webp",
        width: 1200,
        height: 630,
        alt: "Proliferate - Account-Level Bug Intelligence for B2B",
        type: "image/webp",
      },
    ],
  },

  // Twitter Card meta tags
  twitter: {
    card: "summary_large_image",
    site: "@withProliferate",
    creator: "@withProliferate",
    title: "Proliferate | Know When Your Biggest Customers Are Struggling",
    description: "The B2B observability platform that shows you what's happening inside each account. Fix bugs before customers email you.",
    images: ["https://d1uh4o7rpdqkkl.cloudfront.net/og.webp"]
  },
  
  // Additional meta tags
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  
  // Verification tags (add these if you have them)
  // verification: {
  //   google: "your-google-verification-code",
  //   yandex: "your-yandex-verification-code",
  // },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preload images */}
        <link rel="preload" href="https://d1uh4o7rpdqkkl.cloudfront.net/assets/rock.webp" as="image" />
        <link rel="preload" href="https://d1uh4o7rpdqkkl.cloudfront.net/assets/rock2.webp" as="image" />

        {/* Favicon and icons */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp" type="image/webp" />
        <link rel="apple-touch-icon" href="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp" />

        {/* Additional meta tags for better social sharing */}
        <meta name="theme-color" content="#000000" />
        <meta name="msapplication-TileColor" content="#000000" />
        <meta name="msapplication-TileImage" content="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp" />
      </head>
      <body className={`${ibmPlexSans.variable} antialiased bg-black text-white`}>
        <PostHogProviderWrapper>
          <Toaster />
          {/* <SiteHeader /> */}
          {children}
          <Analytics />
        </PostHogProviderWrapper>
      </body>
    </html>
  );
}