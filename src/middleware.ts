// PURPOSE: Next.js middleware — JWT-cookie auth + защита приватных маршрутов
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/privacy',
  '/api/auth',
  '/api/health',
];

const ADMIN_PATHS = ['/app/admin', '/api/admin'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function isAdminPath(pathname: string) {
  return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isAdminPath(pathname)) {
    if (session.globalRole !== 'admin' && session.globalRole !== 'super_admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/app/dashboard', request.url));
    }
  }

  // Прокидываем контекст в заголовки для серверных компонентов
  const headers = new Headers(request.headers);
  headers.set('x-user-id', session.userId);
  if (session.tenantId) headers.set('x-tenant-id', session.tenantId);
  headers.set('x-user-role', session.globalRole);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Не запускаем middleware на статике
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
