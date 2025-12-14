
import Mars from "@/public/assets/hero/martian.webp"
import Telescope from "@/public/assets/hero/telescope.webp"
import ToolBox from "@/public/assets/hero/toolbox.webp"
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