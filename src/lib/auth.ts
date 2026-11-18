import crypto from 'crypto';
import prisma from './prisma';

export type UserRole =
  | 'SUPER_ADMIN'
  | 'BUSINESS_OWNER'
  | 'ACCOUNTANT'
  | 'SALES_EMPLOYEE'
  | 'INVENTORY_MANAGER'
  | 'VIEWER';

export type PermissionKey =
  | 'dashboard.view'
  | 'sales.view'
  | 'sales.create'
  | 'sales.post'
  | 'sales.return'
  | 'sales.overrideStock'
  | 'purchases.view'
  | 'purchases.create'
  | 'purchases.post'
  | 'purchases.return'
  | 'expenses.view'
  | 'expenses.create'
  | 'expenses.approve'
  | 'inventory.view'
  | 'inventory.manage'
  | 'inventory.adjust'
  | 'inventory.transfer'
  | 'customers.view'
  | 'customers.manage'
  | 'suppliers.view'
  | 'suppliers.manage'
  | 'debtors.view'
  | 'debtors.collect'
  | 'creditors.view'
  | 'creditors.pay'
  | 'cashbank.view'
  | 'cashbank.manage'
  | 'cashbank.reconcile'
  | 'accounting.view'
  | 'accounting.manualJournal'
  | 'accounting.reverseJournal'
  | 'accounting.lockPeriod'
  | 'reports.view'
  | 'reports.export'
  | 'users.view'
  | 'users.manage'
  | 'settings.view'
  | 'settings.manage';

export const ALL_PERMISSIONS: PermissionKey[] = [
  'dashboard.view',
  'sales.view',
  'sales.create',
  'sales.post',
  'sales.return',
  'sales.overrideStock',
  'purchases.view',
  'purchases.create',
  'purchases.post',
  'purchases.return',
  'expenses.view',
  'expenses.create',
  'expenses.approve',
  'inventory.view',
  'inventory.manage',
  'inventory.adjust',
  'inventory.transfer',
  'customers.view',
  'customers.manage',
  'suppliers.view',
  'suppliers.manage',
  'debtors.view',
  'debtors.collect',
  'creditors.view',
  'creditors.pay',
  'cashbank.view',
  'cashbank.manage',
  'cashbank.reconcile',
  'accounting.view',
  'accounting.manualJournal',
  'accounting.reverseJournal',
  'accounting.lockPeriod',
  'reports.view',
  'reports.export',
  'users.view',
  'users.manage',
  'settings.view',
  'settings.manage',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  SUPER_ADMIN: [...ALL_PERMISSIONS],
  BUSINESS_OWNER: [...ALL_PERMISSIONS],
  ACCOUNTANT: [
    'dashboard.view',
    'sales.view',
    'sales.post',
    'sales.return',
    'purchases.view',
    'purchases.post',
    'purchases.return',
    'expenses.view',
    'expenses.create',
    'expenses.approve',
    'inventory.view',
    'customers.view',
    'suppliers.view',
    'debtors.view',
    'debtors.collect',
    'creditors.view',
    'creditors.pay',
    'cashbank.view',
    'cashbank.manage',
    'cashbank.reconcile',
    'accounting.view',
    'accounting.manualJournal',
    'accounting.reverseJournal',
    'accounting.lockPeriod',
    'reports.view',
    'reports.export',
    'settings.view',
  ],
  SALES_EMPLOYEE: [
    'dashboard.view',
    'sales.view',
    'sales.create',
    'sales.post',
    'sales.return',
    'inventory.view',
    'customers.view',
    'customers.manage',
    'debtors.view',
    'debtors.collect',
  ],
  INVENTORY_MANAGER: [
    'dashboard.view',
    'purchases.view',
    'purchases.create',
    'purchases.post',
    'purchases.return',
    'inventory.view',
    'inventory.manage',
    'inventory.adjust',
    'inventory.transfer',
    'suppliers.view',
    'suppliers.manage',
    'reports.view',
  ],
  VIEWER: [
    'dashboard.view',
    'sales.view',
    'purchases.view',
    'expenses.view',
    'inventory.view',
    'customers.view',
    'suppliers.view',
    'debtors.view',
    'creditors.view',
    'cashbank.view',
    'accounting.view',
    'reports.view',
  ],
};

/**
 * Hashes a plain password using Node's native crypto.scryptSync with random 16-byte salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * Verifies a password against a stored `salt:hash` string using timing-safe comparison.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, key] = parts;
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

/**
 * Generates a secure random session token.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Checks whether a role has a specific permission, reading custom RolePermission from DB if configured,
 * falling back to DEFAULT_ROLE_PERMISSIONS.
 */
export async function hasPermission(role: string, permission: PermissionKey): Promise<boolean> {
  if (role === 'SUPER_ADMIN' || role === 'BUSINESS_OWNER') {
    return true;
  }
  const customRole = await prisma.rolePermission.findUnique({
    where: { role },
  });
  if (customRole) {
    try {
      const perms = JSON.parse(customRole.permissionsJson) as string[];
      return perms.includes(permission);
    } catch {
      // Fallback
    }
  }
  const defaults = DEFAULT_ROLE_PERMISSIONS[role as UserRole] || [];
  return defaults.includes(permission);
}

export class AuthorizationError extends Error {
  statusCode = 403;
  constructor(message = 'You do not have permission to perform this action') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends Error {
  statusCode = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Enforces that a user is active and holds the required permission.
 */
export async function requirePermission(
  user: { id: string; role: string; isActive: boolean } | null | undefined,
  permission: PermissionKey
): Promise<void> {
  if (!user) {
    throw new AuthenticationError('Please sign in to continue');
  }
  if (!user.isActive) {
    throw new AuthorizationError('Your user account has been deactivated');
  }
  const allowed = await hasPermission(user.role, permission);
  if (!allowed) {
    throw new AuthorizationError(
      `Role '${user.role}' is not authorized for permission '${permission}'`
    );
  }
}

/**
 * Creates an immutable AuditLog entry.
 */
export async function logAudit(params: {
  userId?: string | null;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  entityType: string;
  entityId?: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      userId: params.userId || null,
      userName: params.userName,
      userRole: params.userRole,
      action: params.action,
      module: params.module,
      entityType: params.entityType,
      entityId: params.entityId || null,
      description: params.description,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}
