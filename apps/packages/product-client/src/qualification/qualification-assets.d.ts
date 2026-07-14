declare module "*.css" {
  const href: string;
  export default href;
}

declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.svg?raw" {
  const source: string;
  export default source;
}

declare module "*.txt?raw" {
  const source: string;
  export default source;
}

declare module "*.wav" {
  const url: string;
  export default url;
}

declare module "*.woff2" {
  const url: string;
  export default url;
}
