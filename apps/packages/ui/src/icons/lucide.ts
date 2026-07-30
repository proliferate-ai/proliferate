// Vendor glyphs the design system has not yet drawn in-house.
//
// lucide-react is an implementation detail of @proliferate/ui: product code
// imports every icon from `@proliferate/ui/icons` and never from lucide
// directly (enforced by test/icon-source-guard.test.ts). This module
// re-exports ONLY the lucide names product code actually uses AND that have
// no owned equivalent in the sibling detail modules (core/workspace/product/
// platform/status/app-shell). Where an owned glyph of the same name exists,
// the owned one is canonical and lucide's is not re-exported — do not add a
// name here without first checking the sibling modules.
export {
  AlertTriangle,
  BookMarked,
  BookOpen,
  Bot,
  Braces,
  CheckCircle2,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  CircleHelp,
  Cloud,
  Edit3,
  Eye,
  EyeOff,
  Gauge,
  GitFork,
  Hand,
  HelpCircle,
  Laptop,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Lock,
  MousePointerClick,
  Plug,
  RotateCw,
  Save,
  Scissors,
  Settings2,
  ShieldAlert,
  Trash2,
  Users,
  WifiOff,
  Workflow,
} from "lucide-react";
