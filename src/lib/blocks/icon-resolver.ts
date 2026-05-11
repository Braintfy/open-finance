// PURPOSE: Резолвер lucide-иконки по имени.
// Статический map для часто используемых (быстрый доступ в блоках) + dynamic fallback через icons export.
import {
  ArrowDown,
  ArrowUp,
  Wallet,
  BarChart3,
  PieChart,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Banknote,
  CreditCard,
  Target,
  ListOrdered,
  Table2,
  Activity,
  Calendar,
  Briefcase,
  Building2,
  ShoppingCart,
  Receipt,
  Coins,
  Heart,
  Star,
  Zap,
  Users,
  Database,
  Sparkles,
  icons,
  type LucideIcon,
} from 'lucide-react';

const STATIC_MAP: Record<string, LucideIcon> = {
  ArrowDown,
  ArrowUp,
  Wallet,
  BarChart3,
  PieChart,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Banknote,
  CreditCard,
  Target,
  ListOrdered,
  Table2,
  Activity,
  Calendar,
  Briefcase,
  Building2,
  ShoppingCart,
  Receipt,
  Coins,
  Heart,
  Star,
  Zap,
  Users,
  Database,
  Sparkles,
};

/**
 * Резолвит иконку по имени. Сначала из статического map (быстрый), потом из полного каталога lucide.
 */
export function resolveIcon(name: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;
  if (STATIC_MAP[name]) return STATIC_MAP[name];
  // Dynamic lookup from full lucide icons catalog
  const dynamic = icons[name as keyof typeof icons] as LucideIcon | undefined;
  return dynamic ?? fallback;
}
