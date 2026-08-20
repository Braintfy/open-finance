// PURPOSE: Согласованное обновление блоков склада после записи в журнал.
//
// ЗАЧЕМ. Страница «Склад» — это НЕСКОЛЬКО блоков над ОДНИМ журналом: быстрый
// ввод, лента документов, остатки, сроки годности, пробелы. Каждый из них
// держит свою копию данных, поэтому после проведённого документа обновлялся
// только тот блок, из которого его завели, а соседние продолжали показывать
// прежние цифры — вплоть до ручного F5. Для складского учёта это хуже, чем
// пустой экран: остаток и «деньги в товаре» выглядят достоверно и при этом
// врут.
//
// КАК. Тот же приём, что и у 'ozon-sync-completed' (use-ozon-sync-listener.ts):
// window-событие, а не общий стор — блоки живут в разных поддеревьях грида,
// монтируются и размонтируются независимо, и общий провайдер ради одного
// сигнала им не нужен.
//
// `source` — id блока-инициатора: он обычно перезагружает себя сам (ему нужен
// ответ роута, а не факт события), и без этого поля делал бы двойной запрос.

import { useEffect } from 'react';

const STOCK_CHANGED_EVENT = 'stock-changed';

/**
 * Сообщить всем блокам склада, что журнал изменился (документ проведён,
 * сторнирован, импорт применён). Вызывается ПОСЛЕ успешного ответа роута.
 */
export function emitStockChanged(source?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STOCK_CHANGED_EVENT, { detail: { source } }));
}

/**
 * Подписка блока на изменения журнала.
 *
 * `selfId` — instance.id подписчика: события от самого себя игнорируются,
 * иначе блок-инициатор сходил бы на сервер дважды.
 */
export function useStockChangedListener(fetchData: () => void, selfId?: string): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: string }>).detail;
      if (selfId && detail?.source === selfId) return;
      fetchData();
    };
    window.addEventListener(STOCK_CHANGED_EVENT, handler);
    return () => window.removeEventListener(STOCK_CHANGED_EVENT, handler);
  }, [fetchData, selfId]);
}
