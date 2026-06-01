// PURPOSE: Внешний (вне React-дерева) store снапшотов блоков страницы, ключ —
// pageKey. Наполняется <PageSnapshotPublisher> ВНУТРИ BlockValuesProvider
// (где доступны live-значения), читается модалкой «AI Анализ» в шапке страницы
// (которая живёт ВНЕ провайдера). Так ИИ видит реальный контент блоков.
import type { SectionBlockSnapshot } from '@/lib/ai/section-insights';

type Listener = () => void;

const store = new Map<string, SectionBlockSnapshot[]>();
const listeners = new Map<string, Set<Listener>>();

/** Записать снапшот блоков страницы (вызывает publisher). */
export function setPageSnapshot(pageKey: string, blocks: SectionBlockSnapshot[]): void {
  store.set(pageKey, blocks);
  listeners.get(pageKey)?.forEach((l) => l());
}

/** Прочитать текущий снапшот блоков страницы. */
export function getPageSnapshot(pageKey: string): SectionBlockSnapshot[] {
  return store.get(pageKey) ?? [];
}

/** Подписаться на изменения снапшота конкретной страницы. */
export function subscribePageSnapshot(pageKey: string, listener: Listener): () => void {
  let set = listeners.get(pageKey);
  if (!set) {
    set = new Set();
    listeners.set(pageKey, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}
