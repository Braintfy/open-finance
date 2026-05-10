// PURPOSE: Резолвер lucide-иконки по имени (статический map только нужных, чтобы не раздувать bundle)
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
  type LucideIcon,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
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
};

export function resolveIcon(name: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;
  return MAP[name] ?? fallback;
}
