import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function smoothScrollToHash(hash: string, opts?: { offset?: number; durationMs?: number }) {
  if (typeof window === 'undefined' || !hash || hash[0] !== '#') return false;
  const id = hash.slice(1);
  const target = document.getElementById(id);
  if (!target) return false;

  const headerEl = document.querySelector('header');
  const headerHeight = headerEl instanceof HTMLElement ? headerEl.getBoundingClientRect().height : 64;
  const offset = typeof opts?.offset === 'number' ? opts.offset : Math.round(headerHeight + 8);
  const rectTop = target.getBoundingClientRect().top;
  const startY = window.scrollY || window.pageYOffset;
  const endY = rectTop + startY - offset;
  const distance = endY - startY;
  const duration = Math.max(300, Math.min(1200, opts?.durationMs ?? 650));

  let startTime: number | null = null;
  const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const step = (ts: number) => {
    if (startTime === null) startTime = ts;
    const elapsed = ts - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = easeInOutCubic(t);
    window.scrollTo(0, startY + distance * eased);
    if (t < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
  return true;
}
