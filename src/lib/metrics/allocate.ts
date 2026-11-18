// PURPOSE: Разнесение целой суммы (копейки) по весам с сохранением итога до копейки
// и «потолочное» разнесение рекламы (прямая часть по товарам + остаток). Чистый модуль.
// Причина существования: любой делёж копеек обязан давать Σ частей === целое, иначе
// сверка «факты против журнала» (docs/METRICS_LAYER_DESIGN.md §9) не сойдётся в ноль.

export interface Weight {
  key: string;
  weight: number;
}

export interface AllocationResult {
  parts: { key: string; amountKopecks: number }[];
  unallocatedKopecks: number;
}

function assertInteger(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${what}: ожидалось целое число копеек, получено ${value}`);
  }
}

const f64 = new DataView(new ArrayBuffer(8));

/**
 * Точное разложение конечного положительного double: значение = m * 2^e (m, e целые).
 * Так пропорции нецелых весов (1e-9, 2e-9...) не теряются ни при каком масштабе.
 */
function decompose(w: number): { m: bigint; e: number } {
  f64.setFloat64(0, w);
  const bits = f64.getBigUint64(0);
  const expField = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return expField === 0 ? { m: frac, e: -1074 } : { m: frac | (1n << 52n), e: expField - 1075 };
}

/**
 * Метод наибольших остатков. Знак результата = знак total, ключи уникальны
 * (дубли во входе складываются). Нет годных весов → всё в unallocated.
 */
export function allocate(totalKopecks: number, weights: readonly Weight[]): AllocationResult {
  assertInteger(totalKopecks, 'allocate.totalKopecks');

  // Годные веса раскладываем точно (мантисса × 2^exp); дубли склеиваем уже в BigInt,
  // порядок первого появления ключа сохраняется.
  const order: string[] = [];
  const decomposed = new Map<string, { m: bigint; e: number }[]>();
  for (const w of weights) {
    if (!Number.isFinite(w.weight) || w.weight <= 0) continue;
    const list = decomposed.get(w.key);
    if (list === undefined) {
      order.push(w.key);
      decomposed.set(w.key, [decompose(w.weight)]);
    } else {
      list.push(decompose(w.weight));
    }
  }

  if (order.length === 0) {
    return { parts: [], unallocatedKopecks: totalKopecks };
  }

  // Общий показатель двойки: все веса становятся целыми без потери бита.
  let minE = Infinity;
  for (const list of decomposed.values()) for (const d of list) if (d.e < minE) minE = d.e;
  const big = order.map((key) => {
    let acc = 0n;
    for (const d of decomposed.get(key) as { m: bigint; e: number }[]) acc += d.m << BigInt(d.e - minE);
    return acc;
  });
  const sumW = big.reduce((a, b) => a + b, 0n);

  const sign = totalKopecks < 0 ? -1 : 1;
  const absTotal = BigInt(Math.abs(totalKopecks));

  const floors: bigint[] = [];
  const rems: bigint[] = [];
  let floorSum = 0n;
  for (const w of big) {
    const num = absTotal * w;
    const q = num / sumW;
    floors.push(q);
    rems.push(num % sumW);
    floorSum += q;
  }

  let leftover = Number(absTotal - floorSum);
  // Индексы по убыванию остатка; при равенстве — по порядку появления (стабильность).
  const idx = order.map((_, i) => i);
  idx.sort((a, b) => {
    if (rems[a] === rems[b]) return a - b;
    return rems[a] > rems[b] ? -1 : 1;
  });
  const extra = new Array<number>(order.length).fill(0);
  for (let i = 0; i < idx.length && leftover > 0; i++, leftover--) {
    extra[idx[i]] = 1;
  }

  const parts = order.map((key, i) => {
    const abs = Number(floors[i]) + extra[i];
    return { key, amountKopecks: abs === 0 ? 0 : sign * abs };
  });
  return { parts, unallocatedKopecks: 0 };
}

export interface CappedResult {
  direct: { key: string; amountKopecks: number }[];
  remainderKopecks: number;
  overflowKopecks: number;
}

/**
 * Реклама: итог кампании за день (total) и прямые расходы по товарам.
 * Прямая часть не может превышать итог — при превышении ужимается до итога,
 * а величина превышения возвращается для сверки. Инвариант: Σdirect + remainder === total.
 * Записи direct с одним key склеиваются (первое появление задаёт порядок).
 */
export function allocateCapped(
  totalKopecks: number,
  directAmounts: readonly { key: string; amountKopecks: number }[],
): CappedResult {
  assertInteger(totalKopecks, 'allocateCapped.totalKopecks');

  const sign = Math.sign(totalKopecks);

  if (sign === 0) {
    // Нулевой итог при ненулевых расходах по товарам — именно то расхождение, ради которого
    // нужен overflow: прямых частей нет, всё превышение уходит в сверку со знаком самих расходов.
    let over = 0;
    for (const d of directAmounts) {
      assertInteger(d.amountKopecks, 'allocateCapped.amountKopecks');
      over += d.amountKopecks;
    }
    return { direct: [], remainderKopecks: 0, overflowKopecks: over === 0 ? 0 : over };
  }

  const order: string[] = [];
  const merged = new Map<string, number>();
  for (const d of directAmounts) {
    assertInteger(d.amountKopecks, 'allocateCapped.amountKopecks');
    if (Math.sign(d.amountKopecks) !== sign) continue;
    const prev = merged.get(d.key);
    if (prev === undefined) {
      order.push(d.key);
      merged.set(d.key, d.amountKopecks);
    } else {
      merged.set(d.key, prev + d.amountKopecks);
    }
  }

  const direct = order.map((key) => ({ key, amountKopecks: merged.get(key) as number }));
  const directSum = direct.reduce((a, d) => a + d.amountKopecks, 0);

  if (Math.abs(directSum) <= Math.abs(totalKopecks)) {
    const rem = totalKopecks - directSum;
    return { direct, remainderKopecks: rem === 0 ? 0 : rem, overflowKopecks: 0 };
  }

  const shrunk = allocate(
    totalKopecks,
    direct.map((d) => ({ key: d.key, weight: Math.abs(d.amountKopecks) })),
  );
  return {
    direct: shrunk.parts,
    remainderKopecks: 0,
    overflowKopecks: directSum - totalKopecks,
  };
}
