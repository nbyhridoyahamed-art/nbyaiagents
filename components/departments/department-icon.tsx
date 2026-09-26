import {
  Building2,
  Code2,
  Crown,
  FlaskConical,
  Headphones,
  Landmark,
  type LucideIcon,
  Megaphone,
  Settings2,
  TrendingUp,
  Users,
} from "lucide-react";

export const DEPARTMENT_ICONS: Record<string, LucideIcon> = {
  "building-2": Building2,
  crown: Crown,
  "trending-up": TrendingUp,
  megaphone: Megaphone,
  headphones: Headphones,
  "settings-2": Settings2,
  landmark: Landmark,
  users: Users,
  "code-2": Code2,
  "flask-conical": FlaskConical,
};

export function DepartmentIcon({ icon, color, size = 36 }: { icon: string; color: string; size?: number }) {
  const Icon = DEPARTMENT_ICONS[icon] ?? Building2;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[10px]"
      style={{ width: size, height: size, background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}
