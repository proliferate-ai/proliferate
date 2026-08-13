#!/usr/bin/env node
// Generates the `@source inline(...)` safelist blocks for ds-source.css.
//
// Two families are GENERATED from the token authority (never hand-copied):
//   - color roles:  every `--color-<role>` custom property in theme.css ->
//     `{bg,text,border,ring}-<role>` + `hover:` variants of bg/text/border.
//   - text roles:   every `--text-<role>` custom property in theme.css (the
//     DS's own semantic type ramp) -> `text-<role>`. Stock Tailwind sizes
//     (text-xs..text-6xl) do NOT exist here: theme.css opens with
//     `--text-*: initial`, so only the DS's named roles resolve to anything.
//   - icon utilities: every `@utility icon-*` declared in product.css.
//
// Everything else (spacing/sizing/flex/grid/position/typography-mechanics/
// opacity/shadow/cursor/transition scales) is a STATIC Tailwind vocabulary
// that does not come from our tokens, so it is authored literally below
// rather than "generated" from a authority that doesn't describe it.
//
// Usage: node make-safelist.mjs [themeCssPath] [productCssPath]
//   Prints the composed block to stdout. Also exported as
//   `generateSafelistBlock({ themeCssPath, productCssPath })` for
//   build-css.mjs to import directly.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_THEME_CSS = path.resolve(__dirname, "../../apps/packages/design/dist/theme.css");
const DEFAULT_PRODUCT_CSS = path.resolve(__dirname, "../../apps/packages/design/dist/css/product.css");

/** Extract unique `--color-<role>` names from theme.css (skips the `--color-*: initial` reset). */
function extractColorRoles(themeCss) {
  const roles = new Set();
  const re = /^\s*--color-([a-zA-Z0-9-]+)\s*:/gm;
  let m;
  while ((m = re.exec(themeCss))) {
    const role = m[1];
    if (role === "*") continue;
    roles.add(role);
  }
  return [...roles].sort();
}

/**
 * Extract unique `--text-<role>` names from theme.css. Only bare role
 * declarations count (`--text-body: 14px`); metric siblings like
 * `--text-body--letter-spacing` and `--text-body--line-height` are metadata
 * for the same role, not separate roles, and `--text-*: initial` is the
 * namespace reset.
 */
function extractTextRoles(themeCss) {
  const roles = new Set();
  const re = /^\s*--text-([a-zA-Z0-9-]+)\s*:/gm;
  let m;
  while ((m = re.exec(themeCss))) {
    const role = m[1];
    if (role === "*") continue;
    if (role.includes("--")) continue; // e.g. body--letter-spacing, body--line-height
    roles.add(role);
  }
  return [...roles].sort();
}

/** Extract `@utility icon-<name> { ... }` declarations from product.css. */
function extractIconUtilities(productCss) {
  const names = new Set();
  const re = /@utility\s+(icon-[a-zA-Z0-9-]+)\s*\{/g;
  let m;
  while ((m = re.exec(productCss))) {
    names.add(m[1]);
  }
  return [...names].sort();
}

/** Static Tailwind vocabulary (not token-derived) ported from the old build's ds-source.css. */
const STATIC_BLOCKS = [
  '@source inline("{p,px,py,pt,pr,pb,pl,m,mx,my,mt,mr,mb,ml,gap,gap-x,gap-y,space-x,space-y}-{0,0.5,1,1.5,2,2.5,3,3.5,4,5,6,7,8,9,10,11,12,14,16,20,24,28,32}");',
  '@source inline("{w,h,size,min-w,min-h,max-w,max-h}-{0,1,2,3,4,5,6,7,8,9,10,11,12,14,16,20,24,28,32,40,48,56,64,72,80,96,full,screen,fit,min,max,auto,px}");',
  '@source inline("max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,7xl,prose,none}");',
  '@source inline("{flex,inline-flex,grid,inline-grid,block,inline-block,inline,hidden,contents}");',
  '@source inline("flex-{row,row-reverse,col,col-reverse,wrap,nowrap,1,auto,initial,none,shrink,grow}");',
  '@source inline("{shrink,grow}-{0,1}");',
  '@source inline("grid-cols-{1,2,3,4,5,6,7,8,9,10,11,12,none,subgrid}");',
  '@source inline("grid-rows-{1,2,3,4,5,6,none,subgrid}");',
  '@source inline("col-span-{1,2,3,4,5,6,7,8,9,10,11,12,full}");',
  '@source inline("row-span-{1,2,3,4,5,6,full}");',
  '@source inline("{items,justify,content,self,place-items,place-content,place-self}-{start,end,center,between,around,evenly,stretch,baseline,normal}");',
  '@source inline("{static,relative,absolute,fixed,sticky}");',
  '@source inline("{top,right,bottom,left,inset,inset-x,inset-y}-{0,1,2,3,4,6,8,auto,full}");',
  '@source inline("z-{0,10,20,30,40,50,auto}");',
  '@source inline("overflow-{auto,hidden,visible,scroll,clip}");',
  '@source inline("overflow-{x,y}-{auto,hidden,visible,scroll}");',
  '@source inline("rounded{,-none,-xs,-sm,-md,-lg,-xl,-2xl,-3xl,-4xl,-full}");',
  '@source inline("rounded-{t,r,b,l,tl,tr,br,bl}-{none,xs,sm,md,lg,xl,2xl,3xl,4xl,full}");',
  '@source inline("border{,-0,-2,-4,-8}");',
  '@source inline("border-{t,r,b,l,x,y}{,-0,-2,-4,-8}");',
  '@source inline("{font-,}{thin,light,normal,medium,semibold,bold,extrabold}");',
  '@source inline("text-{left,center,right,justify,start,end}");',
  '@source inline("leading-{none,tight,snug,normal,relaxed,loose,3,4,5,6,7,8,9,10}");',
  '@source inline("tracking-{tighter,tight,normal,wide,wider,widest}");',
  '@source inline("{truncate,text-nowrap,text-wrap,text-balance,break-words,whitespace-nowrap,whitespace-pre,whitespace-pre-wrap,whitespace-normal}");',
  '@source inline("{opacity,}-{0,5,10,20,25,30,40,50,60,70,75,80,90,95,100}");',
  '@source inline("{shadow,shadow-sm,shadow-md,shadow-lg,shadow-xl,shadow-2xl,shadow-none}");',
  '@source inline("{cursor-pointer,cursor-default,cursor-not-allowed,cursor-grab,cursor-grabbing,select-none,select-text,select-all,pointer-events-none,pointer-events-auto}");',
  '@source inline("transition{,-all,-colors,-opacity,-transform,-shadow,-none}");',
  '@source inline("duration-{75,100,150,200,300,500,700,1000}");',
  '@source inline("ease-{linear,in,out,in-out}");',
];

export function generateSafelistBlock({
  themeCssPath = DEFAULT_THEME_CSS,
  productCssPath = DEFAULT_PRODUCT_CSS,
} = {}) {
  const themeCss = readFileSync(themeCssPath, "utf8");
  const productCss = readFileSync(productCssPath, "utf8");

  const colorRoles = extractColorRoles(themeCss);
  const textRoles = extractTextRoles(themeCss);
  const iconUtilities = extractIconUtilities(productCss);

  if (colorRoles.length === 0) {
    throw new Error(`make-safelist: found zero --color-* roles in ${themeCssPath}`);
  }
  if (textRoles.length === 0) {
    throw new Error(`make-safelist: found zero --text-* roles in ${themeCssPath}`);
  }

  const colorRoleList = colorRoles.join(",");
  const textRoleList = textRoles.join(",");

  const lines = [];
  lines.push("/* DS semantic roles, generated from the token authority. */");
  lines.push(
    `/* ${colorRoles.length} --color-* roles, ${textRoles.length} --text-* roles (apps/packages/design/dist/theme.css). */`
  );
  lines.push(`@source inline("{bg,text,border,ring}-{${colorRoleList}}");`);
  lines.push(`@source inline("text-{${textRoleList}}");`);
  lines.push(`@source inline("hover:{bg,text,border}-{${colorRoleList}}");`);
  if (iconUtilities.length > 0) {
    lines.push(
      `/* ${iconUtilities.length} @utility icon-* declarations (apps/packages/design/dist/css/product.css). */`
    );
    lines.push(`@source inline("{${iconUtilities.join(",")}}");`);
  }
  lines.push("");
  lines.push("/* Static Tailwind vocabulary (spacing/sizing/layout/typography mechanics). */");
  lines.push(...STATIC_BLOCKS);

  return lines.join("\n");
}

// CLI entry: print the generated block to stdout.
if (import.meta.url === `file://${process.argv[1]}`) {
  const themeCssPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_THEME_CSS;
  const productCssPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_PRODUCT_CSS;
  process.stdout.write(generateSafelistBlock({ themeCssPath, productCssPath }) + "\n");
}
