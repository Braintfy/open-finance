// PURPOSE: Email-шаблоны (минимальный inline HTML, без внешних либ)

export function welcomeEmail(input: { name?: string | null; appUrl: string }) {
  const greeting = input.name ? `Привет, ${input.name}!` : 'Привет!';
  return {
    subject: 'Добро пожаловать в Open Finance',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
        <h1 style="margin:0 0 16px;font-size:22px">${greeting}</h1>
        <p>Спасибо за регистрацию в <strong>Open Finance</strong>.</p>
        <p>Мы дали вам Pro на 14 дней без оплаты. После окончания триала ничего не спишется — просто часть функций перейдёт в Free.</p>
        <p style="margin:24px 0">
          <a href="${input.appUrl}/dashboard" style="background:#18181b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Открыть кабинет</a>
        </p>
        <p style="color:#71717a;font-size:13px">Если что-то не работает — ответьте на это письмо, мы починим.</p>
      </div>
    `,
    text: `${greeting}\n\nСпасибо за регистрацию в Open Finance. Pro на 14 дней — без оплаты.\nКабинет: ${input.appUrl}/dashboard`,
  };
}

export function resetPasswordEmail(input: { token: string; appUrl: string }) {
  const link = `${input.appUrl}/reset-password?token=${encodeURIComponent(input.token)}`;
  return {
    subject: 'Сброс пароля Open Finance',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
        <h1 style="margin:0 0 16px;font-size:22px">Сброс пароля</h1>
        <p>Кто-то запросил сброс пароля для вашего аккаунта. Если это были вы — нажмите кнопку ниже:</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#18181b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Сбросить пароль</a>
        </p>
        <p style="color:#71717a;font-size:13px">Ссылка действует 1 час. Если вы не запрашивали сброс — просто проигнорируйте письмо.</p>
        <p style="color:#a1a1aa;font-size:12px;word-break:break-all">${link}</p>
      </div>
    `,
    text: `Ссылка для сброса пароля (1 час): ${link}`,
  };
}
