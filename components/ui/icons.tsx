import Image from "next/image"

const CLOUDFRONT_URL = "https://d1uh4o7rpdqkkl.cloudfront.net";

export interface IconProps {
  size: number;
  color: string;
}
export function ToolBoxIcon(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/toolbox.webp`} alt="ToolBox" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}

export function ToolBoxIconMidway(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/toolbox-midway.jpeg`} alt="ToolBox Midway" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}

export function ToolBoxIconHovered(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/toolbox-hovered.jpeg`} alt="ToolBox Hovered" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}


export function TelescopeIcon(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/telescope.jpeg`} alt="Telescope" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}
export function TelescopeIconMidway(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/telescope-midway.jpeg`} alt="Telescope Midway" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}

export function TelescopeIconHovered(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/telescope-hovered.jpeg`} alt="Telescope Hovered" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}

export function MarsIconMidway(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/martian-midway.jpeg`} alt="Mars Midway" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}

export function MarsIconHovered(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/martian-hovered.jpeg`} alt="Mars Hovered" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}

export function MarsIcon(props: IconProps) {
  return (
    <Image src={`${CLOUDFRONT_URL}/assets/hero/martian.jpeg`} alt="Mars" width={props.size} height={props.size} className="w-full h-full object-cover" loading="eager" />
  );
}