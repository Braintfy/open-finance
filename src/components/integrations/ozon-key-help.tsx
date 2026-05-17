// PURPOSE: Складная мини-инструкция «Где взять Client-Id и Api-Key Ozon».
// Отображается в /settings/integrations и (компактнее) в CreateAccountDialog.
// Использует native <details> чтобы не тянуть отдельную Collapsible-обёртку.

'use client';

import { useState } from 'react';
import { ExternalLink, KeyRound, ShieldCheck, Clock, Info } from 'lucide-react';

const SELLER_API_URL = 'https://seller.ozon.ru/app/settings/api-keys';

type Variant = 'full' | 'compact';

export function OzonKeyHelp({
  variant = 'full',
  defaultOpen,
}: {
  /**
   * full — полная карточка с шагами (страница интеграций).
   * compact — короткая подсказка над формой (диалог подключения).
   */
  variant?: Variant;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? variant === 'full');

  if (variant === 'compact') {
    return (
      <details
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        className="group rounded-md border border-border/60 bg-muted/30 text-[11px]"
      >
        <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
          <Info className="h-3 w-3" />
          <span className="select-none">Как получить Client-Id и Api-Key</span>
          <span className="ml-auto text-[10px]">{open ? 'свернуть' : 'показать'}</span>
        </summary>
        <div className="space-y-2 border-t border-border/60 px-2.5 py-2 leading-relaxed">
          <StepsList compact />
        </div>
      </details>
    );
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group overflow-hidden rounded-lg border border-border/60 bg-card"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/30">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">Где взять Client-Id и Api-Key Ozon</div>
          <div className="truncate text-[11px] text-muted-foreground">
            Роль <span className="font-semibold">Admin read only</span> · действует 180 дней
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {open ? 'скрыть' : 'показать'}
        </span>
      </summary>
      <div className="space-y-3 border-t border-border/60 px-4 py-3 text-[12px] leading-relaxed">
        <StepsList />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Callout
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title="Какая роль"
            body={
              <>
                Выберите <b>Admin read only</b> (238 методов). Мы только читаем
                данные — права на запись не нужны.
              </>
            }
          />
          <Callout
            icon={<Clock className="h-3.5 w-3.5" />}
            title="Срок действия"
            body={
              <>
                Ключ работает <b>180 дней</b>, потом Ozon его аннулирует.
                Перевыпустите — и обновите в Open Finance через «Изменить».
              </>
            }
          />
          <Callout
            icon={<KeyRound className="h-3.5 w-3.5" />}
            title="Безопасность"
            body={
              <>
                Ключ хранится зашифрованным (AES-256-GCM), на клиент возвращается
                только маска вида <code className="rounded bg-muted px-1">v1••••Dh</code>.
              </>
            }
          />
        </div>
        <a
          href={SELLER_API_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          Открыть страницу API-ключей Ozon
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </details>
  );
}

function StepsList({ compact }: { compact?: boolean }) {
  const items: Array<{ title: string; hint?: string }> = [
    {
      title: 'Открыть Ozon Seller',
      hint: 'seller.ozon.ru — войти в личный кабинет.',
    },
    {
      title: 'Меню: Настройки → Seller API',
      hint: 'Прямая ссылка ниже откроет нужную страницу.',
    },
    {
      title: 'Нажать «Сгенерировать ключ»',
      hint: 'Откроется диалог выбора роли.',
    },
    {
      title: 'Роль — Admin read only',
      hint: '238 методов, только чтение. Этого достаточно для Open Finance.',
    },
    {
      title: 'Назначить имя ключу и сгенерировать',
      hint: 'Например, «Open Finance».',
    },
    {
      title: 'Скопировать Api-Key',
      hint: 'Ключ показывается ОДИН раз — сразу вставьте в форму ниже.',
    },
    {
      title: 'Скопировать Client-Id',
      hint: 'На той же странице сверху, рядом с заголовком.',
    },
  ];
  return (
    <ol
      className={
        'list-decimal pl-5 ' + (compact ? 'space-y-0.5 marker:text-muted-foreground' : 'space-y-1.5 marker:text-muted-foreground')
      }
    >
      {items.map((it, i) => (
        <li key={i}>
          <span className={compact ? 'font-medium' : 'font-medium'}>{it.title}</span>
          {it.hint && !compact && (
            <span className="block text-[11px] text-muted-foreground">{it.hint}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Callout({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="text-[11px] leading-relaxed text-foreground/90">{body}</div>
    </div>
  );
}
