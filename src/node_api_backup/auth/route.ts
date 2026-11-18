import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import {
  generateSessionToken,
  hashPassword,
  logAudit,
  verifyPassword,
} from '@/lib/auth';
import {
  getSessionUser,
  handleApiError,
  SESSION_COOKIE_NAME,
} from '@/lib/server-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'login') {
      const { identifier, password } = body;
      if (!identifier || !password) {
        return NextResponse.json(
          { error: 'Username/Email and password are required' },
          { status: 400 }
        );
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: identifier.trim() },
            { email: identifier.trim().toLowerCase() },
          ],
        },
      });

      if (!user || !verifyPassword(password, user.passwordHash)) {
        return NextResponse.json(
          { error: 'Invalid credentials. Please verify your username and password.' },
          { status: 401 }
        );
      }

      if (!user.isActive) {
        return NextResponse.json(
          { error: 'This employee account has been deactivated by an administrator.' },
          { status: 403 }
        );
      }

      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.session.create({
        data: {
          token,
          userId: user.id,
          expiresAt,
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'USER_LOGIN',
        module: 'AUTH',
        entityType: 'User',
        entityId: user.id,
        description: `${user.name} (${user.role}) signed in.`,
      });

      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        path: '/',
        expires: expiresAt,
        sameSite: 'lax',
      });

      return NextResponse.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
          preferredLanguage: user.preferredLanguage,
          preferredCurrency: user.preferredCurrency,
        },
        token,
      });
    }

    if (action === 'switchRole') {
      // Quick role switch for testing/verifying RBAC across the 6 enterprise roles
      const { role } = body;
      const targetUser = await prisma.user.findFirst({
        where: { role, isActive: true },
      });
      if (!targetUser) {
        return NextResponse.json(
          { error: `No active user found for role ${role}` },
          { status: 404 }
        );
      }

      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.session.create({
        data: {
          token,
          userId: targetUser.id,
          expiresAt,
        },
      });

      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        path: '/',
        expires: expiresAt,
        sameSite: 'lax',
      });

      return NextResponse.json({
        user: {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          username: targetUser.username,
          role: targetUser.role,
        },
      });
    }

    if (action === 'logout') {
      const cookieStore = await cookies();
      const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      if (token) {
        await prisma.session.deleteMany({ where: { token } });
      }
      cookieStore.delete(SESSION_COOKIE_NAME);
      return NextResponse.json({ success: true });
    }

    if (action === 'changePassword') {
      const user = await getSessionUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const { currentPassword, newPassword } = body;
      if (!newPassword || newPassword.length < 6) {
        return NextResponse.json(
          { error: 'New password must be at least 6 characters' },
          { status: 400 }
        );
      }
      if (currentPassword && !verifyPassword(currentPassword, user.passwordHash)) {
        return NextResponse.json(
          { error: 'Current password is incorrect' },
          { status: 400 }
        );
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(newPassword) },
      });
      await logAudit({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'PASSWORD_CHANGED',
        module: 'AUTH',
        entityType: 'User',
        entityId: user.id,
        description: `Password updated for user ${user.username}.`,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid auth action' }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
