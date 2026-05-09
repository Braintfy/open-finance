// PURPOSE: Next.js middleware — auth check + tenant context
// Добавляет cookie-based session проверку и устанавливает tenant context
// TODO: реализовать после Auth (Этап 1 PLAN.md)
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/api/auth', '/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Публичные маршруты пропускаем
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // TODO: реальная auth-проверка через NextAuth.js v5
  // const session = await auth();
  // if (!session) return NextResponse.redirect(new URL('/login', request.url));

  // TODO: загрузить tenant context, прокинуть в headers
  // const tenant = await getTenantBySession(session);
  // request.headers.set('x-tenant-id', tenant.id);

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Не запускаем middleware на статических ассетах
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
