// PURPOSE: Module Registry — центральный реестр всех модулей
// Каждый модуль регистрируется здесь и становится доступным для активации пользователем
import type { Module } from './types';

const registry: Module[] = [];

export function registerModule(module: Module): void {
  if (registry.some((m) => m.slug === module.slug)) {
    throw new Error(`Module "${module.slug}" already registered`);
  }
  registry.push(module);
}

export function getModule(slug: string): Module | undefined {
  return registry.find((m) => m.slug === slug);
}

export function listModules(): Module[] {
  return [...registry];
}

export function listModulesByCategory(category: Module['category']): Module[] {
  return registry.filter((m) => m.category === category);
}
