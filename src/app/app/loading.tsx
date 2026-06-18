// PURPOSE: Route-level loading для всего /app-сегмента. Рендерится в <main> пока
// серверный RSC страницы await'ит БД → навигация показывает скелет-оболочку,
// а не «зависший» предыдущий экран. Статический сайдбар/хедер уже отрисованы
// layout'ом (он не блокируется на БД — см. layout.tsx, B0).
import { BlockGridSkeleton } from '@/components/blocks/block-grid-skeleton';

export default function AppLoading() {
  return <BlockGridSkeleton count={6} />;
}
