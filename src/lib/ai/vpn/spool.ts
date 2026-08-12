// PURPOSE: Единственный способ, которым web-процесс «применяет» Xray-конфиг —
// атомарная запись spool-файла (0600). Никакого exec/sudo: конфиг подхватывает
// root-овый systemd path-юнит (deploy/xray/of-xray-apply.path) и ставит его на хост.
//
// Раскладка spool-директории (по умолчанию /var/lib/open-finance/xray):
//   config.json       — то, что просит применить админка (пишем мы, 0600)
//   config.meta.json  — отпечаток/автор/время запроса (пишем мы, 0600)
//   status.json       — результат применения (пишет of-xray-apply.sh, читаем мы)
//
// Порядок важен: meta пишем ПЕРВЫМ, config.json — вторым (именно он триггерит
// path-юнит, к этому моменту meta уже на месте).

import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from '@/lib/env';

export type SpoolMeta = {
  /** Полный sha256-отпечаток параметров подключения (см. vless.ts). */
  fingerprint: string;
  /** Публичное имя сервера — попадает в status.json и логи хоста. */
  server: string;
  /** ISO-время запроса. */
  requestedAt: string;
  /** Кто применил (userId) — для сопоставления с ai_audit_log. */
  requestedBy: string;
  tenantId: string;
};

/** Результат применения, который пишет of-xray-apply.sh. Все поля опциональны — файл внешний. */
export type XrayApplyStatus = {
  ok?: boolean;
  /** validating | testing | installing | restarting | applied | failed | rolled_back */
  phase?: string;
  fingerprint?: string;
  server?: string;
  appliedAt?: string;
  error?: string;
  xrayActive?: boolean;
  externalIp?: string;
  configSha256?: string;
};

export function getSpoolConfigPath(): string {
  return env.XRAY_SPOOL_PATH;
}

export function getSpoolDir(): string {
  return path.dirname(getSpoolConfigPath());
}

export function getSpoolStatusPath(): string {
  return path.join(getSpoolDir(), 'status.json');
}

export function getSpoolMetaPath(): string {
  return path.join(getSpoolDir(), 'config.meta.json');
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp`;
  // mode в writeFile режется umask — доводим права явным chmod.
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, target); // rename → path-юнит срабатывает ровно один раз
}

/**
 * Записать spool-конфиг + мету. Бросает понятную ошибку, если директории нет
 * или у процесса нет прав (типичная ситуация в dev — это нормально).
 */
export async function writeSpoolConfig(config: unknown, meta: SpoolMeta): Promise<{ path: string }> {
  const configPath = getSpoolConfigPath();
  const dir = path.dirname(configPath);

  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch {
    // Директорию обычно создаёт деплой (root, chown на пользователя приложения).
    // Ошибку игнорируем — реальную проблему покажет запись файла ниже.
  }

  const json = `${JSON.stringify(config, null, 2)}\n`;
  if (Buffer.byteLength(json, 'utf8') > 256 * 1024) {
    throw new Error('Конфиг Xray подозрительно большой (>256KB) — отказ записи');
  }

  try {
    await writeAtomic(getSpoolMetaPath(), `${JSON.stringify(meta, null, 2)}\n`);
    await writeAtomic(configPath, json);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Нет прав на запись spool-конфига (${configPath}). На сервере: ` +
          `sudo install -d -o <app-user> -g <app-user> -m 0700 ${dir} (см. deploy/xray/README.md)`,
      );
    }
    if (code === 'ENOENT') {
      throw new Error(
        `Spool-директория ${dir} не существует. Установите юниты по deploy/xray/README.md ` +
          `или укажите другой путь в XRAY_SPOOL_PATH.`,
      );
    }
    throw new Error(
      `Не удалось записать spool-конфиг: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  }

  return { path: configPath };
}

/**
 * Прочитать status.json, который оставил apply-скрипт на хосте.
 * null — файла нет / не читается / это не JSON (в dev это норма).
 */
export async function readApplyStatus(): Promise<XrayApplyStatus | null> {
  try {
    const raw = await fs.readFile(getSpoolStatusPath(), 'utf8');
    if (raw.length > 64 * 1024) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as XrayApplyStatus;
  } catch {
    return null;
  }
}

/** Есть ли доступ на запись в spool-директорию (для честной диагностики в UI). */
export async function isSpoolWritable(): Promise<boolean> {
  try {
    await fs.access(getSpoolDir(), fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}
