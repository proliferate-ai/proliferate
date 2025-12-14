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
              src="/logotype-inverted.png"
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
              href="/signin"
              className="text-[13.5px] font-medium text-gray-50 hover:bg-neutral-800 h-9 rounded-lg px-3 bg-transparent flex items-center transition-colors"
              style={{ boxShadow: 'none' }}
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
            <SheetContent side="right" className="w-[300px] sm:w-[400px] bg-black border-gray-800 pt-20 px-6">
              <nav className="flex flex-col gap-4">
                <Link
                  href="/#product"
                  className="block px-2 py-1 text-lg font-medium text-gray-300 hover:text-white"
                  onClick={(e) => { onAnchorClick(e as unknown as MouseEvent, '#product'); setIsOpen(false); }}
                >
                  Product
                </Link>
                <Link
                  href="/#how-it-works"
                  className="block px-2 py-1 text-lg font-medium text-gray-300 hover:text-white"
                  onClick={(e) => { onAnchorClick(e as unknown as MouseEvent, '#how-it-works'); setIsOpen(false); }}
                >
                  How it works
                </Link>
                {/* <Link
                  href="/blog"
                  className="block px-2 py-1 text-lg font-medium text-gray-300 hover:text-white"
                  onClick={() => setIsOpen(false)}
                >
                  Blog
                </Link> */}
                {/* <Link
                  target="_blank"
                  href="https://docs.withproliferate.com"
                  className="block px-2 py-1 text-lg font-medium text-gray-300 hover:text-white"
                  onClick={() => setIsOpen(false)}
                >
                  Docs
                </Link> */}
                {/* <Link
                  href="/#pricing"
                  className="block px-2 py-1 text-lg font-medium text-gray-300 hover:text-white"
                  onClick={(e) => { onAnchorClick(e as unknown as MouseEvent, '#pricing'); setIsOpen(false); }}
                >
                  Pricing
                </Link> */}
                <div className="flex flex-col gap-2 mt-4">
                  <Button
                    variant="outline"
                    className="text-sm font-medium border border-gray-700 text-gray-300 hover:bg-neutral-800 w-full"
                    onClick={() => { setIsTalkOpen(true); setIsOpen(false); }}>
                    Request demo
                  </Button>
                  <WaitlistForm>
                    <Button className="bg-white text-black hover:bg-gray-100 font-medium w-full">
                      Join early access
                    </Button>
                  </WaitlistForm>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
          <TalkToFounderModal open={isTalkOpen} onOpenChange={setIsTalkOpen} />
        </div>
      </div>
    </header >
  );
}
