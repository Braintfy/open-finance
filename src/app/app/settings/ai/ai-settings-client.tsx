// PURPOSE: Клиентский UI персональных AI-настроек пользователя.
// Карточки провайдеров: RU (без VPN) и зарубежные (через VPN).
// Каждая карточка: toggle "использовать мой ключ", ввод apiKey, тест подключения.
'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sparkles,
  Eye,
  EyeOff,
  TestTube,
  Trash2,
  CheckCircle2,
  XCircle,
  Shield,
  Globe,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';

type Credential = {
  id: string;
  provider: string;
  baseUrl: string;
  apiKey: string; // masked
  defaultModel: string;
  useProxy: boolean;
  enabled: boolean;
  updatedAt?: string;
};

type ProviderCard = {
  id: string;
  label: string;
  description: string;
  requiresVpn: boolean | null;
  category: 'ru' | 'vpn' | 'proxy' | 'custom';
  defaultModel: string;
  signupUrl?: string;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
};

const PROVIDER_CARDS: ProviderCard[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek-V3 и DeepSeek-R1 — мощные модели доступные из РФ напрямую.',
    requiresVpn: false,
    category: 'ru',
    defaultModel: 'deepseek-chat',
    signupUrl: 'https://platform.deepseek.com/api_keys',
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'yandex',
    label: 'Yandex GPT',
    description: 'YandexGPT 5 от Яндекса. Требует Folder ID и IAM/API ключ.',
    requiresVpn: false,
    category: 'ru',
    defaultModel: 'yandexgpt/rc',
    signupUrl: 'https://console.yandex.cloud/folders',
    apiKeyLabel: 'API Key (IAM или статический)',
    apiKeyPlaceholder: 'AQVN...',
  },
  {
    id: 'gigachat',
    label: 'GigaChat (Сбер)',
    description: 'GigaChat Pro/Max от Сбера — российская GPT-модель.',
    requiresVpn: false,
    category: 'ru',
    defaultModel: 'GigaChat-Max',
    signupUrl: 'https://developers.sber.ru/portal/products/gigachat',
    apiKeyLabel: 'Authorization Key (Base64)',
    apiKeyPlaceholder: 'YjU3ODA...',
  },
  {
    id: 'vsegpt',
    label: 'VseGPT',
    description: 'Российский агрегатор GPT-моделей, не требует VPN.',
    requiresVpn: false,
    category: 'proxy',
    defaultModel: 'openai/gpt-4o-mini',
    signupUrl: 'https://vsegpt.ru/',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    description: 'GPT-4o и другие. Требует VPN или прокси из РФ.',
    requiresVpn: true,
    category: 'vpn',
    defaultModel: 'gpt-4o-mini',
    signupUrl: 'https://platform.openai.com/api-keys',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Claude 3.5/4. Требует VPN из РФ.',
    requiresVpn: true,
    category: 'vpn',
    defaultModel: 'claude-3-5-haiku-20241022',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '300+ моделей через единый API. Требует VPN из РФ.',
    requiresVpn: true,
    category: 'vpn',
    defaultModel: 'openai/gpt-4o-mini',
    signupUrl: 'https://openrouter.ai/keys',
    apiKeyPlaceholder: 'sk-or-...',
  },
];

type TestResult = { ok: boolean; message: string };

function VpnBadge({ requiresVpn }: { requiresVpn: boolean | null }) {
  if (requiresVpn === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
        <Globe className="h-2.5 w-2.5" />
        Без VPN
      </span>
    );
  }
  if (requiresVpn === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-400">
        <Shield className="h-2.5 w-2.5" />
        Через VPN
      </span>
    );
  }
  return null;
}

function ProviderCardUI({ card, credential, onSave, onDelete }: {
  card: ProviderCard;
  credential?: Credential;
  onSave: (provider: string, apiKey: string, model: string, enabled: boolean) => Promise<void>;
  onDelete: (provider: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(credential?.defaultModel ?? card.defaultModel);
  const [enabled, setEnabled] = useState(credential?.enabled ?? false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Sync from credential
  useEffect(() => {
    if (credential) {
      setApiKey(credential.apiKey); // masked
      setModel(credential.defaultModel || card.defaultModel);
      setEnabled(credential.enabled);
    }
  }, [credential, card.defaultModel]);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await onSave(card.id, apiKey, model, enabled);
      setTestResult(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: card.id, apiKey, defaultModel: model }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string; modelsCount?: number; sample?: string[] };
      if (data.ok) {
        const msg = data.modelsCount != null
          ? `Подключено. Доступно ${data.modelsCount} моделей.`
          : (data.message ?? 'Подключение успешно');
        setTestResult({ ok: true, message: msg });
      } else {
        setTestResult({ ok: false, message: data.error ?? 'Ошибка соединения' });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setTesting(false);
    }
  }

  async function handleToggleEnabled(val: boolean) {
    setEnabled(val);
    if (credential) {
      setSaving(true);
      try {
        await onSave(card.id, apiKey, model, val);
      } finally {
        setSaving(false);
      }
    }
  }

  const hasCredential = !!credential;
  const isActive = hasCredential && enabled;

  return (
    <Card className={`transition-colors ${isActive ? 'border-primary/40 bg-primary/5' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold">{card.label}</CardTitle>
              <VpnBadge requiresVpn={card.requiresVpn} />
              {isActive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Sparkles className="h-2.5 w-2.5" /> Активен
                </span>
              )}
            </div>
            <CardDescription className="mt-0.5 text-[11px] leading-snug">{card.description}</CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasCredential && (
              <Switch
                checked={enabled}
                onCheckedChange={handleToggleEnabled}
                disabled={saving}
                aria-label="Использовать мой ключ"
              />
            )}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {card.apiKeyLabel ?? 'API Key'}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={card.apiKeyPlaceholder ?? 'Вставьте ключ'}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 pr-8 font-mono text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Модель по умолчанию
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={card.defaultModel}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${testResult.ok ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
              {testResult.ok
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              }
              {testResult.message}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={!apiKey.trim() || testing}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
              Проверить
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {hasCredential ? 'Обновить' : 'Сохранить'}
            </Button>
            {hasCredential && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(card.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </Button>
            )}
            {card.signupUrl && (
              <a
                href={card.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Получить ключ ↗
              </a>
            )}
          </div>

          {!hasCredential && (
            <p className="text-[11px] text-muted-foreground">
              Сохраните ключ, затем включите переключатель «Использовать мой ключ» чтобы этот провайдер стал активным.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function AiSettingsClient() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/credentials');
      const data = (await res.json()) as { ok: boolean; credentials: Credential[] };
      if (data.ok) setCredentials(data.credentials);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(provider: string, apiKey: string, model: string, enabled: boolean) {
    await fetch('/api/ai/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, defaultModel: model, enabled }),
    });
    await load();
    setSuccessMsg(`${provider} сохранён`);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function handleDelete(provider: string) {
    await fetch(`/api/ai/credentials?provider=${provider}`, { method: 'DELETE' });
    await load();
  }

  const ruCards = PROVIDER_CARDS.filter((c) => c.requiresVpn === false);
  const vpnCards = PROVIDER_CARDS.filter((c) => c.requiresVpn === true);

  const getCredential = (provider: string) => credentials.find((c) => c.provider === provider);

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <Link href="/app/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-lg font-semibold tracking-tight">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Настройки
          </h1>
          <p className="text-xs text-muted-foreground">
            Подключите свои API ключи. По умолчанию используются ключи администратора платформы.
          </p>
        </div>
      </div>

      {successMsg && (
        <Alert>
          <AlertDescription className="text-xs">✓ {successMsg}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-green-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Доступны из РФ без VPN
              </span>
            </div>
            <div className="space-y-3">
              {ruCards.map((card) => (
                <ProviderCardUI
                  key={card.id}
                  card={card}
                  credential={getCredential(card.id)}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Требуют VPN из РФ
              </span>
            </div>
            <div className="space-y-3">
              {vpnCards.map((card) => (
                <ProviderCardUI
                  key={card.id}
                  card={card}
                  credential={getCredential(card.id)}
                  onSave={handleSave}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </section>

          <Alert className="border-border/50 bg-muted/30">
            <AlertDescription className="text-[11px] leading-snug">
              <span className="font-medium">Примечание:</span> Ключи хранятся в базе данных.
              Если у вас не подключён личный ключ, используются глобальные ключи администратора платформы (если настроены).
              Ключи отображаются замаскированными — это нормально.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
