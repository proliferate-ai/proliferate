
const Mars = "https://d1uh4o7rpdqkkl.cloudfront.net/assets/hero/martian.webp"
const Telescope = "https://d1uh4o7rpdqkkl.cloudfront.net/assets/hero/telescope.webp"
const ToolBox = "https://d1uh4o7rpdqkkl.cloudfront.net/assets/hero/toolbox.webp"
import Image from "next/image"

export interface IconProps {
  size: number;
  color: string;
}
export function ToolBoxIcon(props: IconProps) {
  return (
    <Image src={ToolBox} alt="ToolBox" width={props.size} height={props.size} className="w-full h-full object-cover" />
  );
}

export function TelescopeIcon(props: IconProps) {
  return (
    <Image src={Telescope} alt="Telescope" width={props.size} height={props.size} className="w-full h-full object-cover" />
  );
}
export function MarsIcon(props: IconProps) {
  return (
    <Image src={Mars} alt="Mars" width={props.size} height={props.size} className="w-full h-full object-cover" />
  );
}