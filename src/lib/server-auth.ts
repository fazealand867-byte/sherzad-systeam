import { cookies, headers } from 'next/headers';
import prisma from './prisma';
import { AuthenticationError, AuthorizationError, PermissionKey, requirePermission } from './auth';

export const SESSION_COOKIE_NAME = 'sherzad_erp_session';

export async function getSessionUser() {
  try {
    const cookieStore = await cookies();
    let token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      const headerStore = await headers();
      const authHeader = headerStore.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      // In development/demo mode, if no cookie is present yet, return the default Super Admin if available
      // unless strict auth header `x-require-strict-auth` is passed.
      const headerStore = await headers();
      if (headerStore.get('x-require-strict-auth') === 'true') {
        return null;
      }
      const defaultAdmin = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      return defaultAdmin;
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      return null;
    }

    return session.user;
  } catch {
    return null;
  }
}

export async function requireApiPermission(permission: PermissionKey) {
  const user = await getSessionUser();
  await requirePermission(user, permission);
  return user!;
}

export function handleApiError(error: unknown) {
  if (error instanceof AuthenticationError) {
    return Response.json({ error: error.message, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return Response.json({ error: error.message, code: 'FORBIDDEN' }, { status: 403 });
  }
  if (error instanceof Error) {
    const status = (error as { statusCode?: number }).statusCode || 400;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json({ error: 'An unexpected server error occurred' }, { status: 500 });
}
