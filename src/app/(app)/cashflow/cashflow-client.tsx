// PURPOSE: /cashflow — Block-Grid обёртка с действиями страницы (добавить, импорт)
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BlockGrid } from '@/components/blocks/block-grid';
import { PagePeriodHeader } from '@/components/blocks/page-period-header';
import {
  CashflowDataProvider,
  type CashflowSummary,
  type CashflowCategory,
  type CashflowTx,
} from '@/lib/blocks/catalog/cashflow-data';
import { TransactionDialog } from '@/lib/blocks/catalog/transaction-dialog';
import { PagePeriodProvider } from '@/lib/blocks/page-period-context';
import { PageSourceProvider } from '@/lib/blocks/page-source-context';
import { DrillDownProvider } from '@/lib/blocks/drill-down';
import { VirtualSourcesBridge } from '@/lib/blocks/virtual-sources';
import type { BlockInstance } from '@/lib/blocks/types';
import { formatRubles, formatDate } from '@/lib/utils';

export function CashflowClient({
  tenantId,
  initialBlocks,
  summary,
  topIncome,
  topExpense,
  initialTransactions,
}: {
  tenantId: string;
  initialBlocks: BlockInstance[];
  summary: CashflowSummary;
  topIncome: CashflowCategory[];
  topExpense: CashflowCategory[];
  initialTransactions: CashflowTx[];
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  return (
    <PagePeriodProvider pageKey="cashflow" defaultPreset="mtd">
      <PageSourceProvider pageKey="cashflow" defaultValue={null}>
        <DrillDownProvider>
          <div className="mx-auto max-w-[1400px] space-y-3">
            <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight">Денежный поток</h1>
                <p className="text-xs text-muted-foreground">
                  Доходы и расходы — все блоки наследуют единый период страницы и источник
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                  <Upload /> Импорт
                </Button>
                <Button size="sm" onClick={() => setShowAdd(true)}>
                  <Plus /> Добавить
                </Button>
              </div>
            </div>

            <PagePeriodHeader
              description="Период и источник — наследуются всеми KPI и графиками"
              showSourceFilter
            />

              <BlockGrid pageKey="cashflow" tenantId={tenantId} initialBlocks={initialBlocks}>
              {(grid) => (
                <CashflowDataProvider
                  value={{
                    summary,
                    topIncome,
                    topExpense,
                    transactions: initialTransactions,
                  }}
                >
                  <VirtualSourcesBridge />
                  {grid}
                </CashflowDataProvider>
              )}
            </BlockGrid>

            <TransactionDialog
              open={showAdd}
              initial={null}
              onClose={() => setShowAdd(false)}
              onSaved={() => {
                setShowAdd(false);
                router.refresh();
              }}
            />

            <ImportDialog
              open={showImport}
              onClose={() => setShowImport(false)}
              onDone={() => {
                setShowImport(false);
                router.refresh();
              }}
            />
          </div>
        </DrillDownProvider>
      </PageSourceProvider>
    </PagePeriodProvider>
  );
}

function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    totalRows: number;
    sample: Array<{ date: string; amount: number; type: string; counterparty?: string }>;
    detectedFormat?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    setLoading(false);
  }

  async function doUpload(commit: boolean) {
    if (!file) return;
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('commit', commit ? 'true' : 'false');
    const res = await fetch('/api/cashflow/import', { method: 'POST', body: fd });
    const data = await res.json();
    setLoading(false);
    if (!data.ok) {
      setError(data.error || 'Не удалось разобрать файл');
      return;
    }
    if (commit) {
      reset();
      onDone();
    } else {
      setPreview(data);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Импорт банковской выписки</DialogTitle>
          <DialogDescription>
            CSV или XLSX. Поддержка форматов Тинькофф, Сбер, generic. Авто-определение колонок Дата
            / Сумма / Контрагент / Описание.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setError(null);
            }}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-2">
              <p className="text-sm">
                Найдено <strong>{preview.totalRows}</strong> операций. Формат:{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {preview.detectedFormat}
                </code>
              </p>
              <div className="max-h-64 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Сумма</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Контрагент</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.slice(0, 10).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell
                          className={
                            r.type === 'income' ? 'text-green-600' : 'text-red-600'
                          }
                        >
                          {r.type === 'income' ? '+' : '−'}
                          {formatRubles(r.amount)}
                        </TableCell>
                        <TableCell className="text-xs">{r.type}</TableCell>
                        <TableCell className="line-clamp-1 max-w-xs text-xs">
                          {r.counterparty ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Отмена
          </Button>
          {!preview ? (
            <Button onClick={() => doUpload(false)} disabled={!file || loading}>
              {loading ? 'Анализируем…' : 'Превью'}
            </Button>
          ) : (
            <Button onClick={() => doUpload(true)} disabled={loading}>
              {loading ? 'Импортируем…' : `Импортировать ${preview.totalRows} операций`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
