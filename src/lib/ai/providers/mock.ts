// PURPOSE: Детерминированный AI-провайдер для разработки и e2e тестов.
// Не делает реальных вызовов. Возвращает предсказуемые ответы по ключевым словам в prompt.
// Активируется через AI_DEFAULT_PROVIDER=mock или AI_MOCK_ENABLED=true.

export type MockMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type MockResponse = {
  content: string;
  tokensIn: number;
  tokensOut: number;
  provider: 'mock';
  model: string;
  durationMs: number;
};

const SCRIPTED_RESPONSES: Array<{ match: RegExp; reply: string }> = [
  {
    match: /налог|УСН|ПСН|НПД/i,
    reply:
      '[mock] Налог УСН-6% за Q1 = 12 600 ₽. Срок оплаты — до 25 апреля. Поставлю напоминание за 5 дней.',
  },
  {
    match: /остаток|сколько на счет|баланс/i,
    reply: '[mock] Остаток по всем счетам: 248 350 ₽. Динамика за месяц: +12%.',
  },
  {
    match: /чек|разнес|категори/i,
    reply:
      '[mock] Чек разобран: 1 250 ₽, кафе «Кофе на углу», категория «Бизнес-обеды». Сохранил.',
  },
  {
    match: /дедлайн|напомни|срок/i,
    reply:
      '[mock] Создал напоминание: «Сдать отчёт» на 30 апреля 12:00. Дублирую в Telegram-бота.',
  },
];

export async function mockGenerate(messages: MockMessage[]): Promise<MockResponse> {
  const start = Date.now();
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const matched = SCRIPTED_RESPONSES.find(({ match }) => match.test(lastUserMsg));
  const content = matched
    ? matched.reply
    : `[mock] Ответ-заглушка на запрос: "${lastUserMsg.slice(0, 80)}". Подключи реальный провайдер в настройках.`;

  // Имитируем латенси
  await new Promise((r) => setTimeout(r, 80));

  const tokensIn = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
  const tokensOut = Math.ceil(content.length / 4);

  return {
    content,
    tokensIn,
    tokensOut,
    provider: 'mock',
    model: 'mock-1.0',
    durationMs: Date.now() - start,
  };
}
