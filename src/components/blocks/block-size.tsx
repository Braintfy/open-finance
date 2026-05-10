// PURPOSE: Универсальная система размеров блоков — useBlockSize hook,
// контекст, плотности (density) для адаптивного рендера и защита от нечитаемого контента.
'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Плотность контента блока — вычисляется из фактического размера в пикселях.
 * Блоки должны использовать `useBlockDensity()` и рендерить разные варианты.
 *
 * - `xs` — 1x1 (очень мелко): только иконка или одно число
 * - `sm` — ~2x1 / 1x2: иконка + число, без подписи
 * - `md` — базовый вариант (3x2 и больше)
 * - `lg` — много места, можно добавлять детали
 */
export type BlockDensity = 'xs' | 'sm' | 'md' | 'lg';

export type BlockSize = {
  /** Измеренная ширина в px (0 пока не смонтировано) */
  width: number;
  /** Измеренная высота в px */
  height: number;
  /** Текущая плотность на основе width×height */
  density: BlockDensity;
};

/** Пороги для определения density (в пикселях, используем площадь + минимум по обоим осям) */
const DENSITY_THRESHOLDS = {
  // xs: оба размера очень малы (1x1 ~100×40)
  xsMaxW: 150,
  xsMaxH: 80,
  xsMaxArea: 12_000, // 150×80
  // sm: один из размеров мал И площадь мала (≤240×140 = 33_600)
  smMaxW: 180,
  smMaxH: 90,
  smMaxArea: 33_600,
  // md: средний размер (≤480×280 = 134_400)
  mdMaxArea: 134_400,
};

function computeDensity(width: number, height: number): BlockDensity {
  if (width <= 0 || height <= 0) return 'md';
  const area = width * height;
  // xs: оба размера маленькие (действительно крошечный блок)
  if (width <= DENSITY_THRESHOLDS.xsMaxW && height <= DENSITY_THRESHOLDS.xsMaxH) return 'xs';
  // xs по площади (даже если один размер чуть больше — площадь всё ещё крошечная)
  if (area <= DENSITY_THRESHOLDS.xsMaxArea) return 'xs';
  // sm: площадь мала ИЛИ оба размера ≤ sm порога
  if (width <= DENSITY_THRESHOLDS.smMaxW && height <= DENSITY_THRESHOLDS.smMaxH) return 'sm';
  if (area <= DENSITY_THRESHOLDS.smMaxArea) return 'sm';
  // md: площадь средняя
  if (area <= DENSITY_THRESHOLDS.mdMaxArea) return 'md';
  return 'lg';
}

const BlockSizeContext = createContext<BlockSize>({
  width: 0,
  height: 0,
  density: 'md',
});

export function useBlockSize(): BlockSize {
  return useContext(BlockSizeContext);
}

export function useBlockDensity(): BlockDensity {
  return useContext(BlockSizeContext).density;
}

/**
 * Провайдер размера — оборачивает содержимое блока. Измеряет себя ResizeObserver'ом.
 * Рендерит children и, если размер меньше `minContent`, показывает warning overlay.
 */
export function BlockSizeProvider({
  children,
  minContent,
}: {
  children: ReactNode;
  /** Минимальный размер для читаемости в пикселях. Если реальный меньше — показываем warning */
  minContent?: { w: number; h: number };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ctx = useMemo<BlockSize>(
    () => ({
      width: size.width,
      height: size.height,
      density: computeDensity(size.width, size.height),
    }),
    [size]
  );

  const tooSmall =
    minContent &&
    size.width > 0 &&
    size.height > 0 &&
    (size.width < minContent.w || size.height < minContent.h);

  return (
    <BlockSizeContext.Provider value={ctx}>
      <div ref={ref} className="relative h-full w-full">
        {tooSmall ? <TooSmallOverlay minContent={minContent!} /> : null}
        <div className={tooSmall ? 'pointer-events-none h-full w-full opacity-30' : 'h-full w-full'}>
          {children}
        </div>
      </div>
    </BlockSizeContext.Provider>
  );
}

function TooSmallOverlay({ minContent }: { minContent: { w: number; h: number } }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-lg bg-background/90 p-2 text-center text-[10px] text-muted-foreground backdrop-blur-sm">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
      >
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <circle cx="12" cy="12" r="10" />
      </svg>
      <div className="font-medium">Мало места</div>
      <div className="text-[9px] leading-tight text-muted-foreground/70">
        нужно ≥ {minContent.w}×{minContent.h}px
      </div>
    </div>
  );
}

/** Хелпер: выбрать вариант рендера по density */
export function byDensity<T>(
  density: BlockDensity,
  variants: { xs?: T; sm?: T; md?: T; lg?: T; default: T }
): T {
  if (density === 'xs' && variants.xs !== undefined) return variants.xs;
  if (density === 'sm' && variants.sm !== undefined) return variants.sm;
  if (density === 'md' && variants.md !== undefined) return variants.md;
  if (density === 'lg' && variants.lg !== undefined) return variants.lg;
  return variants.default;
}
