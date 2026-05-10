// PURPOSE: Smoke-тест парсера на реальной выписке Тинькофф (запускать tsx-ом).
import fs from 'node:fs';
import { parseCsv } from '../src/lib/cashflow/import';

const path = process.argv[2];
if (!path) {
  console.error('Usage: tsx scripts/test-tinkoff-import.mts <file.csv>');
  process.exit(1);
}

const text = fs.readFileSync(path, 'utf8');
const result = parseCsv(text);

console.log(`detectedFormat: ${result.detectedFormat}`);
console.log(`errors: ${result.errors.length ? result.errors.join('; ') : '(нет)'}`);
console.log(`rows: ${result.rows.length}`);
if (result.rows.length > 0) {
  console.log('--- первые 5 операций ---');
  for (const r of result.rows.slice(0, 5)) {
    const sign = r.type === 'income' ? '+' : '−';
    console.log(
      `${r.date.toISOString().slice(0, 10)}  ${sign}${(r.amount / 100).toFixed(2).padStart(12)} ₽  [${r.type}]  ${r.counterparty ?? '—'}  ${(r.description ?? '').slice(0, 60)}`
    );
  }
  const totalIncome = result.rows
    .filter((r) => r.type === 'income')
    .reduce((s, r) => s + r.amount, 0);
  const totalExpense = result.rows
    .filter((r) => r.type === 'expense')
    .reduce((s, r) => s + r.amount, 0);
  console.log('---');
  console.log(`Всего доходов: ${(totalIncome / 100).toFixed(2)} ₽`);
  console.log(`Всего расходов: ${(totalExpense / 100).toFixed(2)} ₽`);
  console.log(`Баланс: ${((totalIncome - totalExpense) / 100).toFixed(2)} ₽`);
}
