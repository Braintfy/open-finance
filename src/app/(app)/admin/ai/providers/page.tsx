// PURPOSE: Настройки внешних AI провайдеров (OpenAI/Claude/OpenRouter/etc) + VPN/Proxy + диагностика
'use client';

import { useEffect, useState } from 'react';
import {
  Save,
  TestTube,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Globe,
  Shield,
  Activity,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', signupUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-20241022', signupUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', label: 'OpenRouter (300+ моделей)', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', signupUrl: 'https://openrouter.ai/keys' },
  { id: 'vsegpt', label: 'VseGPT (РФ-проксирование)', baseUrl: 'https://api.vsegpt.ru/v1', model: 'openai/gpt-4o-mini', signupUrl: 'https://vsegpt.ru/' },
  { id: 'custom', label: 'Свой OpenAI-совместимый API', baseUrl: '', model: '', signupUrl: '' },
] as const;

type ProviderId = typeof PROVIDERS[number]['id'];

type AiExternal = {
  enabled: boolean;
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  useProxy?: boolean;
  hasApiKey?: boolean;
};

type AiProxy = {
  enabled: boolean;
  url: string;
  type: 'http' | 'https' | 'socks5';
  username?: string;
  password?: string;
  hasPassword?: boolean;
};

type CheckResult = {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  message: string;
  details?: Record<string, unknown>;
};

const EMPTY_EXTERNAL: AiExternal = {
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  defaultModel: 'gpt-4o-mini',
  useProxy: false,
};

const EMPTY_PROXY: AiProxy = {
  enabled: false,
  url: '',
  type: 'http',
  username: '',
  password: '',
};

export default function AiProvidersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [external, setExternal] = useState<AiExternal>(EMPTY_EXTERNAL);
  const [proxy, setProxy] = useState<AiProxy>(EMPTY_PROXY);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [testingExternal, setTestingExternal] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const [externalTestResult, setExternalTestResult] = useState<{ ok: boolean; message: string; sample?: string[] } | null>(null);
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<CheckResult[] | null>(null);
  const [runningDiag, setRunningDiag] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/ai/providers');
      const data = (await res.json()) as { ok: boolean; aiExternal: AiExternal | null; aiProxy: AiProxy | null };
      if (data.ok) {
        setExternal(data.aiExternal ?? EMPTY_EXTERNAL);
        setProxy(data.aiProxy ?? EMPTY_PROXY);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function selectProvider(id: ProviderId) {
    const p = PROVIDERS.find((x) => x.id === id);
    if (!p) return;
    setExternal((prev) => ({
      ...prev,
      provider: id,
      baseUrl: id === 'custom' ? prev.baseUrl : p.baseUrl,
      defaultModel: id === 'custom' ? prev.defaultModel : p.model,
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      // Сохраняем только не-пустые секции
      body.aiExternal = external;
      body.aiProxy = proxy;
      const res = await fetch('/api/admin/ai/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setSavedAt(new Date().toLocaleTimeString('ru-RU'));
        await load();
      } else {
        alert(`Ошибка сохранения: ${typeof json.error === 'string' ? json.error : JSON.stringify(json.error)}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function testExternal() {
    setTestingExternal(true);
    setExternalTestResult(null);
    try {
      const res = await fetch('/api/admin/ai/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'external', aiExternal: external, aiProxy: proxy }),
      });
      const data = await res.json();
      if (data.ok) {
        setExternalTestResult({
          ok: true,
          message: `Подключение успешно. Доступно ${data.modelsCount} моделей.`,
          sample: data.sample,
        });
      } else {
        setExternalTestResult({ ok: false, message: data.error ?? 'Неизвестная ошибка' });
      }
    } catch (e) {
      setExternalTestResult({ ok: false, message: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setTestingExternal(false);
    }
  }

  async function testProxy() {
    setTestingProxy(true);
    setProxyTestResult(null);
    try {
      const res = await fetch('/api/admin/ai/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'proxy', aiProxy: proxy }),
      });
      const data = await res.json();
      if (data.ok) {
        setProxyTestResult({
          ok: true,
          message: `Прокси работает. Внешний IP: ${data.ip}${data.country ? ` (${data.country}${data.city ? `, ${data.city}` : ''})` : ''}. Latency: ${data.latencyMs}ms`,
        });
      } else {
        setProxyTestResult({ ok: false, message: data.error ?? 'Неизвестная ошибка' });
      }
    } catch (e) {
      setProxyTestResult({ ok: false, message: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setTestingProxy(false);
    }
  }

  async function runDiagnostics() {
    setRunningDiag(true);
    try {
      const res = await fetch('/api/admin/ai/diagnostics');
      const data = (await res.json()) as { ok: boolean; checks: CheckResult[] };
      if (data.ok) setDiagnostics(data.checks);
    } finally {
      setRunningDiag(false);
    }
  }

  const selectedProvider = PROVIDERS.find((p) => p.id === external.provider);
  const rootClass = embedded ? 'space-y-4' : 'mx-auto max-w-[1200px] space-y-4';
  const headerClass = embedded ? 'pb-2' : undefined;
  const titleClass = embedded ? 'flex items-center gap-2 text-sm' : 'flex items-center gap-2 text-base';
  const saveClass = embedded
    ? 'flex items-center justify-end gap-3'
    : 'sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t border-border/60 bg-background/95 px-2 py-3 backdrop-blur';

  return (
    <div className={rootClass}>
      {!embedded && <div className="border-b border-border/60 pb-3">
        <h1 className="text-lg font-semibold tracking-tight">AI Провайдеры и Сеть</h1>
        <p className="text-xs text-muted-foreground">
          Внешние API (OpenAI / Claude / OpenRouter), VPN-прокси и диагностика
        </p>
      </div>}

      {/* ─────────── Диагностика ─────────── */}
      <Card>
        <CardHeader className={headerClass}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className={titleClass}>
                <Activity className="h-4 w-4" />
                Диагностика
              </CardTitle>
              <CardDescription className="text-xs">
                Проверить что всё работает: Ollama, внешний API, прокси
              </CardDescription>
            </div>
            <Button onClick={runDiagnostics} disabled={runningDiag} size="sm">
              <Activity className={runningDiag ? 'animate-pulse' : ''} />
              {runningDiag ? 'Проверяю…' : 'Запустить'}
            </Button>
          </div>
        </CardHeader>
        {diagnostics && (
          <CardContent className="space-y-2">
            {diagnostics.map((c, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  c.status === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
                    : c.status === 'warning'
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
                    : c.status === 'error'
                    ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                    : 'border-border bg-muted/30'
                }`}
              >
                {c.status === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
                {c.status === 'warning' && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                {c.status === 'error' && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                {c.status === 'skipped' && <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-muted-foreground/40" />}
                <div className="flex-1 space-y-1">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.message}</div>
                  {c.details && (
                    <details className="text-[11px] text-muted-foreground/80">
                      <summary className="cursor-pointer">Детали</summary>
                      <pre className="mt-1 overflow-auto rounded bg-muted/50 p-1.5">
                        {JSON.stringify(c.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {/* ─────────── Внешний AI Provider ─────────── */}
      <Card>
        <CardHeader className={headerClass}>
          <CardTitle className={titleClass}>
            <Globe className="h-4 w-4" />
            Внешний AI API
          </CardTitle>
          <CardDescription className="text-xs">
            Использовать OpenAI / Claude / другую OpenAI-совместимую модель вместо локальной Ollama.
            Когда включено — все AI-вызовы идут через указанный провайдер.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={external.enabled}
              onChange={(e) => setExternal({ ...external, enabled: e.target.checked })}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Включить внешний провайдер</span>
          </label>

          <div className={external.enabled ? '' : 'opacity-50 pointer-events-none'}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Провайдер</label>
                <div className="grid gap-1">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProvider(p.id)}
                      className={`flex items-center justify-between rounded-md border p-2 text-left text-xs transition ${
                        external.provider === p.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <span>{p.label}</span>
                      {p.signupUrl && (
                        <a
                          href={p.signupUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
                        >
                          получить ключ <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Base URL</label>
                  <input
                    type="text"
                    value={external.baseUrl}
                    onChange={(e) => setExternal({ ...external, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={external.provider !== 'custom'}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">API Key</label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={external.apiKey}
                      onChange={(e) => setExternal({ ...external, apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full rounded-md border bg-background px-3 py-1.5 pr-9 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {!external.apiKey && (
                    <p className="mt-1 text-[10px] text-amber-600">
                      Без ключа провайдер работать не будет
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Модель по-умолчанию {selectedProvider?.model && (
                      <span className="text-[10px] text-muted-foreground">(пример: {selectedProvider.model})</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={external.defaultModel}
                    onChange={(e) => setExternal({ ...external, defaultModel: e.target.value })}
                    placeholder="gpt-4o-mini"
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={external.useProxy ?? false}
                    onChange={(e) => setExternal({ ...external, useProxy: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className="text-xs">Через прокси (см. ниже)</span>
                </label>
              </div>
            </div>

            <Alert variant="warning" className="mt-3">
              <AlertCircle />
              <AlertDescription className="text-[11px]">
                <strong>Безопасность:</strong> ключ хранится в БД в открытом виде (JSONB).
                Доступ только для super_admin. В production — переносить в Vault/Doppler.
              </AlertDescription>
            </Alert>

            <div className="mt-3 flex items-center gap-2">
              <Button
                onClick={testExternal}
                disabled={testingExternal || !external.apiKey || !external.baseUrl}
                size="sm"
                variant="outline"
              >
                <TestTube className={testingExternal ? 'animate-pulse' : ''} />
                {testingExternal ? 'Тестирую…' : 'Проверить подключение'}
              </Button>
              {externalTestResult && (
                <div
                  className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
                    externalTestResult.ok
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                  }`}
                >
                  {externalTestResult.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                  <div>
                    <div>{externalTestResult.message}</div>
                    {externalTestResult.sample && externalTestResult.sample.length > 0 && (
                      <div className="mt-0.5 text-[10px] opacity-80">
                        Примеры: {externalTestResult.sample.slice(0, 5).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─────────── VPN / Proxy ─────────── */}
      <Card>
        <CardHeader className={headerClass}>
          <CardTitle className={titleClass}>
            <Shield className="h-4 w-4" />
            VPN / Прокси
          </CardTitle>
          <CardDescription className="text-xs">
            HTTP/HTTPS прокси для обхода блокировок (если внешний AI недоступен напрямую из РФ).
            Включается отдельно для конкретного провайдера выше.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={proxy.enabled}
              onChange={(e) => setProxy({ ...proxy, enabled: e.target.checked })}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Включить прокси</span>
          </label>

          <div className={proxy.enabled ? '' : 'opacity-50 pointer-events-none'}>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Тип</label>
                <select
                  value={proxy.type}
                  onChange={(e) => setProxy({ ...proxy, type: e.target.value as 'http' | 'https' | 'socks5' })}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5" disabled>SOCKS5 (скоро)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">URL прокси</label>
                <input
                  type="text"
                  value={proxy.url}
                  onChange={(e) => setProxy({ ...proxy, url: e.target.value })}
                  placeholder="http://my-proxy.example.com:3128"
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Логин (опц.)</label>
                <input
                  type="text"
                  value={proxy.username ?? ''}
                  onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
                  placeholder="username"
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Пароль (опц.)</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={proxy.password ?? ''}
                    onChange={(e) => setProxy({ ...proxy, password: e.target.value })}
                    placeholder="password"
                    className="w-full rounded-md border bg-background px-3 py-1.5 pr-9 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <Alert className="mt-3">
              <AlertDescription className="text-[11px]">
                Требуется пакет <code className="rounded bg-muted px-1">undici</code>. Установите:{' '}
                <code className="rounded bg-muted px-1">pnpm add undici</code>. SOCKS5 пока не поддерживается — используйте HTTP/HTTPS.
              </AlertDescription>
            </Alert>

            <div className="mt-3 flex items-center gap-2">
              <Button
                onClick={testProxy}
                disabled={testingProxy || !proxy.url}
                size="sm"
                variant="outline"
              >
                <TestTube className={testingProxy ? 'animate-pulse' : ''} />
                {testingProxy ? 'Тестирую…' : 'Проверить прокси'}
              </Button>
              {proxyTestResult && (
                <div
                  className={`rounded-md px-2 py-1 text-xs ${
                    proxyTestResult.ok
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                  }`}
                >
                  {proxyTestResult.message}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─────────── Сохранить ─────────── */}
      <div className={saveClass}>
        {savedAt && (
          <span className="text-xs text-muted-foreground">Сохранено: {savedAt}</span>
        )}
        <Button onClick={save} disabled={saving || loading}>
          <Save />
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}
