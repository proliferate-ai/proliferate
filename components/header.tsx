// header2

"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { TalkToFounderModal } from "./talk-to-founder-modal";
import { WaitlistForm } from "./waitlist-form";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { smoothScrollToHash } from "@/lib/utils";
import type { MouseEvent } from "react";



export function SiteHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const [isTalkOpen, setIsTalkOpen] = useState(false);
  const router = useRouter();

  const onAnchorClick = (e: MouseEvent, hash: string) => {
    e.preventDefault();
    const ok = smoothScrollToHash(hash);
    if (ok) {
      try {
        window.history.replaceState(null, "", `/${hash}`);
      } catch { }
    } else {
      router.push(`/${hash}`);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full  h-14   bg-transparent transition duration-100">
    {/* <header className="sticky top-0 z-50 w-full  h-14 border-b border-gray-800/50 bg-black/95 backdrop-blur-md transition duration-100"> */}
      <div className="proliferate-container  flex h-14 items-center justify-between">
        <div className="flex items-center">
          <Link href="/" className="flex items-center">
            <Image
              src="https://d1uh4o7rpdqkkl.cloudfront.net/logotype-inverted.webp"
              alt="Proliferate Logo"
              width={6290}
              height={1000}
              className="revert h-[20px] w-auto"
            />
            {/* <span className="hidden font-bold sm:inline-block text-white text-sm">Proliferate</span> */}
          </Link>
        </div>

        {/* <nav className="hidden md:flex absolute left-1/2 transform -translate-x-1/2 z-10">
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <Link href="/#product" passHref>
                  <NavigationMenuLink onClick={(e) => onAnchorClick(e, '#product')} className="text-[13.5px] font-medium text-gray-300 hover:text-white px-3 py-1 rounded-md hover:bg-neutral-800/50 transition-colors">
                    Product
                  </NavigationMenuLink>
                </Link>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <Link href="/#how-it-works" passHref>
                  <NavigationMenuLink onClick={(e) => onAnchorClick(e, '#how-it-works')} className="text-[13.5px] font-medium text-gray-300 hover:text-white px-3 py-1 rounded-md hover:bg-neutral-800/50 transition-colors">
                    How it works
                  </NavigationMenuLink>
                </Link>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <span className="flex cursor-not-allowed items-center gap-1 text-[13.5px] font-medium text-gray-300 px-3 py-1 rounded-md relative select-none">
                  <span className="flex items-center gap-1">
                    Docs
                    <Badge className="text-xs" variant="secondary">
                      coming soon
                    </Badge>
                  </span>
                </span>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </nav> */}

        <div className="flex items-center gap-4">
          <div className="hidden md:flex gap-2">
            <Link
              href="https://app.withkeystone.com"
              className="text-[13.5px] font-medium text-gray-50 hover:text-white h-9 px-3 flex items-center whitespace-nowrap transition-colors"
            >
              Sign in
            </Link>
            <WaitlistForm>
              <Button
                className="text-[13.5px] font-medium bg-white text-black hover:bg-gray-100 h-9 rounded-lg px-3 border-[0.5px] border-white/20"
                style={{ boxShadow: 'rgba(255, 255, 255, 0.04) 0px 3px 3px, rgba(255, 255, 255, 0.05) 0px 1px 2px, rgba(0, 0, 0, 0.05) 0px 6px 12px inset, rgba(0, 0, 0, 0.15) 0px 1px 1px inset' }}>
                Join early access
              </Button>
            </WaitlistForm>
          </div>
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="outline" size="icon" className="border-gray-700 text-gray-300 hover:text-white hover:bg-gray-900">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-[400px] bg-neutral-950 border-neutral-800 p-0 flex flex-col">
              {/* Header with logo and close button */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-800/50">
                <Link href="/" onClick={() => setIsOpen(false)}>
                  <Image
                    src="https://d1uh4o7rpdqkkl.cloudfront.net/logotype-inverted.webp"
                    alt="Proliferate Logo"
                    width={6290}
                    height={1000}
                    className="h-[18px] w-auto"
                  />
                </Link>
              </div>

              {/* Navigation links */}
              <nav className="flex-1 px-6 py-8">
                <div className="space-y-1">
                  <Link
                    href="/#product"
                    className="block py-3 text-2xl font-medium text-neutral-100 hover:text-white transition-colors"
                    onClick={(e) => { onAnchorClick(e as unknown as MouseEvent, '#product'); setIsOpen(false); }}
                  >
                    Product
                  </Link>
                  <Link
                    href="/#how-it-works"
                    className="block py-3 text-2xl font-medium text-neutral-100 hover:text-white transition-colors"
                    onClick={(e) => { onAnchorClick(e as unknown as MouseEvent, '#how-it-works'); setIsOpen(false); }}
                  >
                    How it works
                  </Link>
                  <button
                    className="block py-3 text-2xl font-medium text-neutral-100 hover:text-white transition-colors w-full text-left"
                    onClick={() => { setIsTalkOpen(true); setIsOpen(false); }}
                  >
                    Request demo
                  </button>
                </div>
              </nav>

              {/* Footer with CTA */}
              <div className="px-4 pb-8 pt-4 border-t border-neutral-800/50 mt-auto">
                <WaitlistForm>
                  <Button
                    className="w-full h-12 text-[15px] font-semibold bg-white text-black hover:bg-neutral-100 rounded-xl transition-all"
                    style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.1), 0 4px 12px rgba(0,0,0,0.1)' }}
                  >
                    Join early access
                  </Button>
                </WaitlistForm>
                <p className="text-center text-xs text-neutral-500 mt-3">
                  Get notified when we launch
                </p>
              </div>
            </SheetContent>
          </Sheet>
          <TalkToFounderModal open={isTalkOpen} onOpenChange={setIsTalkOpen} />
        </div>
      </div>
    </header >
  );
}
