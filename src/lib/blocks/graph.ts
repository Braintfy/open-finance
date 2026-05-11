// PURPOSE: Графовые утилиты для Block Dependencies — cycle detection,
// topological sort, поиск зависимых блоков. Предотвращает бесконечные
// циклы в реактивных вычислениях (A→B→C→A).

import type { BlockInstance } from './types';

/**
 * Строит adjacency list из блоков: blockId → Set<dependencyBlockId>
 * (т.е. «этот блок зависит от этих блоков»).
 */
export function buildDependencyGraph(
  blocks: BlockInstance[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const block of blocks) {
    const deps = new Set<string>();
    if (block.dependencies?.sources) {
      for (const src of block.dependencies.sources) {
        // Только локальные зависимости (без pageKey или с текущей страницей)
        if (!src.pageKey) {
          deps.add(src.blockId);
        }
      }
    }
    graph.set(block.id, deps);
  }
  return graph;
}

/**
 * Проверяет, создаст ли добавление зависимости fromId → toId цикл.
 * Использует DFS для поиска пути toId → ... → fromId.
 *
 * @param graph Текущий граф зависимостей
 * @param fromId Блок, в который добавляется зависимость
 * @param toId Блок-источник, на который ссылается fromId
 * @returns true если добавление создаёт цикл
 */
export function wouldCreateCycle(
  graph: Map<string, Set<string>>,
  fromId: string,
  toId: string
): boolean {
  // Самоссылка — всегда цикл
  if (fromId === toId) return true;

  // DFS: проверяем, достижим ли fromId из toId (через текущие рёбра)
  const visited = new Set<string>();
  const stack = [toId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = graph.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }
  }
  return false;
}

/**
 * Находит все циклы в графе зависимостей (для диагностики / UI warning).
 * Возвращает список id блоков, участвующих в циклах.
 */
export function findCyclicBlocks(
  graph: Map<string, Set<string>>
): Set<string> {
  const WHITE = 0; // не посещён
  const GRAY = 1; // в текущем DFS-стеке
  const BLACK = 2; // полностью обработан

  const color = new Map<string, number>();
  const cyclic = new Set<string>();

  for (const id of graph.keys()) {
    color.set(id, WHITE);
  }

  function dfs(u: string): void {
    color.set(u, GRAY);
    const neighbors = graph.get(u);
    if (neighbors) {
      for (const v of neighbors) {
        const c = color.get(v) ?? WHITE;
        if (c === GRAY) {
          // Нашли back edge → цикл
          cyclic.add(u);
          cyclic.add(v);
        } else if (c === WHITE) {
          dfs(v);
          if (cyclic.has(v)) {
            cyclic.add(u);
          }
        }
      }
    }
    color.set(u, BLACK);
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cyclic;
}

/**
 * Топологическая сортировка блоков (Kahn's algorithm).
 * Определяет порядок вычисления: сначала блоки без зависимостей,
 * потом блоки зависящие от них, и т.д.
 *
 * @returns Отсортированный массив blockId, или null если есть циклы.
 */
export function topologicalSort(
  graph: Map<string, Set<string>>
): string[] | null {
  // Считаем in-degree (сколько блоков зависят ОТ данного → сколько рёбер ВХОДЯТ)
  // Наш граф: A → {B, C} означает «A зависит от B и C»
  // Для topo sort нужен обратный граф: B → {A}, C → {A} (кто ОТ меня зависит)
  const inDegree = new Map<string, number>();
  const reverseGraph = new Map<string, Set<string>>();

  for (const id of graph.keys()) {
    inDegree.set(id, 0);
    reverseGraph.set(id, new Set());
  }

  for (const [id, deps] of graph) {
    // id зависит от deps → in-degree[id] += deps.size
    inDegree.set(id, (inDegree.get(id) ?? 0) + deps.size);
    // Обратный граф: dep → id (dep влияет на id)
    for (const dep of deps) {
      if (!reverseGraph.has(dep)) {
        reverseGraph.set(dep, new Set());
      }
      reverseGraph.get(dep)!.add(id);
    }
  }

  // Начинаем с узлов без входящих зависимостей
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    const dependents = reverseGraph.get(current);
    if (dependents) {
      for (const dep of dependents) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) queue.push(dep);
      }
    }
  }

  // Если не все узлы в sorted — есть цикл
  if (sorted.length < graph.size) return null;
  return sorted;
}

/**
 * Находит все блоки, которые прямо или транзитивно зависят от данного blockId.
 * Используется для инвалидации: при изменении блока X нужно пересчитать всех его потребителей.
 */
export function findDependents(
  graph: Map<string, Set<string>>,
  blockId: string
): Set<string> {
  // Строим обратный граф: «кто зависит от данного блока»
  const reverseGraph = new Map<string, Set<string>>();
  for (const [id, deps] of graph) {
    for (const dep of deps) {
      if (!reverseGraph.has(dep)) {
        reverseGraph.set(dep, new Set());
      }
      reverseGraph.get(dep)!.add(id);
    }
  }

  // BFS по обратному графу
  const result = new Set<string>();
  const queue = [blockId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverseGraph.get(current);
    if (dependents) {
      for (const dep of dependents) {
        if (!result.has(dep)) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }
  }
  return result;
}
