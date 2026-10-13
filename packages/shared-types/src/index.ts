/**
 * Aurel Restaurant Commerce & Operations Platform
 * Shared TypeScript Contracts & API Types
 */

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta: {
    timestamp: string;
    requestId?: string;
  };
}

export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  CSRF_ERROR = 'CSRF_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ApiErrorResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code?: string;
  requestId?: string;
  errors?: Record<string, string[]>;
  timestamp: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  service: string;
  version: string;
  checks: {
    database: 'connected' | 'disconnected';
    uptimeSeconds: number;
  };
}

export enum FulfillmentChannel {
  DELIVERY = 'DELIVERY',
  PICKUP = 'PICKUP',
  DINE_IN = 'DINE_IN',
}

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  STAFF = 'STAFF',
  KITCHEN = 'KITCHEN',
  MANAGER = 'MANAGER',
  ADMIN = 'ADMIN',
}

export enum OrderStatus {
  PLACED = 'PLACED',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  COLLECTED = 'COLLECTED',
  SERVED = 'SERVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentStatus {
  INITIATED = 'INITIATED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum TableSessionStatus {
  ACTIVE = 'ACTIVE',
  BILL_REQUESTED = 'BILL_REQUESTED',
  BILLED = 'BILLED',
  CLOSED = 'CLOSED',
}

export interface RegisterCustomerRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export interface PublicUserResponse {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  role?: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface StaffUserResponse extends PublicUserResponse {
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}

export interface CsrfTokenResponse {
  csrfToken: string;
}

export enum Permission {
  // Identity & Staff Administration
  STAFF_SELF_READ = 'staff.self.read',
  STAFF_READ = 'staff.read',
  STAFF_CREATE = 'staff.create',
  STAFF_UPDATE = 'staff.update',
  STAFF_ACTIVATE = 'staff.activate',
  STAFF_DEACTIVATE = 'staff.deactivate',
  STAFF_ROLE_ASSIGN = 'staff.role.assign',
  ADMIN_CREATE = 'admin.create',
  AUDIT_READ = 'audit.read',

  // Reserved Architectural Permissions (P0 Blueprint)
  CATALOG_READ = 'catalog.read',
  CATALOG_WRITE = 'catalog.write',
  ORDERS_VIEW = 'orders.view',
  ORDERS_SERVE = 'orders.serve',
  ORDERS_PREPARE = 'orders.prepare',
  TABLES_MANAGE = 'tables.manage',
  SYSTEM_CONFIGURE = 'system.configure',
}

export enum AuditAction {
  STAFF_USER_CREATED = 'STAFF_USER_CREATED',
  USER_ROLE_UPDATED = 'USER_ROLE_UPDATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  USER_REACTIVATED = 'USER_REACTIVATED',
  INITIAL_ADMIN_BOOTSTRAPPED = 'INITIAL_ADMIN_BOOTSTRAPPED',
  STAFF_PASSWORD_ESTABLISHED = 'STAFF_PASSWORD_ESTABLISHED',
}

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  [UserRole.CUSTOMER]: new Set([]),
  [UserRole.STAFF]: new Set([
    Permission.STAFF_SELF_READ,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_SERVE,
  ]),
  [UserRole.KITCHEN]: new Set([
    Permission.STAFF_SELF_READ,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_PREPARE,
  ]),
  [UserRole.MANAGER]: new Set([
    Permission.STAFF_SELF_READ,
    Permission.STAFF_READ,
    Permission.STAFF_CREATE,
    Permission.STAFF_UPDATE,
    Permission.STAFF_ACTIVATE,
    Permission.STAFF_DEACTIVATE,
    Permission.STAFF_ROLE_ASSIGN,
    Permission.CATALOG_READ,
    Permission.CATALOG_WRITE,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_PREPARE,
    Permission.ORDERS_SERVE,
    Permission.TABLES_MANAGE,
  ]),
  [UserRole.ADMIN]: new Set([
    Permission.STAFF_SELF_READ,
    Permission.STAFF_READ,
    Permission.STAFF_CREATE,
    Permission.STAFF_UPDATE,
    Permission.STAFF_ACTIVATE,
    Permission.STAFF_DEACTIVATE,
    Permission.STAFF_ROLE_ASSIGN,
    Permission.ADMIN_CREATE,
    Permission.AUDIT_READ,
    Permission.SYSTEM_CONFIGURE,
    Permission.CATALOG_READ,
    Permission.CATALOG_WRITE,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_PREPARE,
    Permission.ORDERS_SERVE,
    Permission.TABLES_MANAGE,
  ]),
};

export function hasPermission(role: UserRole | undefined | null, permission: Permission): boolean {
  if (!role || !ROLE_PERMISSIONS[role]) {
    return false;
  }
  return ROLE_PERMISSIONS[role].has(permission);
}

export interface CreateStaffRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: UserRole;
}

export interface UpdateStaffRoleRequest {
  role: UserRole;
}

export interface UpdateStaffStatusRequest {
  isActive: boolean;
}

export interface SetupPasswordRequest {
  token: string;
  newPassword: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLogEntry {
  id: string;
  actorId?: string | null;
  targetId?: string | null;
  action: AuditAction;
  requestId?: string | null;
  clientIp?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

// ==========================================
// Phase 2 — Restaurant Commerce Contracts
// ==========================================

export enum PaymentMode {
  CASH = 'CASH',
  DEMO = 'DEMO',
}

export interface MenuItemModifierOption {
  id: string;
  groupId: string;
  name: string;
  pricePaise: number;
  isDefault: boolean;
}

export interface MenuItemModifierGroup {
  id: string;
  itemId: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: MenuItemModifierOption[];
}

export interface MenuItemSummary {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  pricePaise: number;
  imageUrl?: string | null;
  isAvailable: boolean;
  dietaryFlags: string[];
  modifierGroups?: MenuItemModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
  items: MenuItemSummary[];
}

export interface CreateOrderItemRequest {
  menuItemId: string;
  quantity: number;
  selectedOptionIds?: string[];
}

export interface CreateOrderRequest {
  idempotencyKey: string;
  fulfillmentChannel: FulfillmentChannel;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress?: string;
  tableNumber?: string;
  specialInstructions?: string;
  items: CreateOrderItemRequest[];
  paymentMode: PaymentMode;
}

export interface OrderItemModifierSummary {
  optionId: string;
  name: string;
  pricePaise: number;
}

export interface OrderItemSummary {
  id: string;
  menuItemId: string;
  name: string;
  unitPricePaise: number;
  quantity: number;
  modifiers: OrderItemModifierSummary[];
  lineTotalPaise: number;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  idempotencyKey: string;
  guestAccessToken?: string;
  customerId?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  fulfillmentChannel: FulfillmentChannel;
  deliveryAddress?: string | null;
  tableNumber?: string | null;
  specialInstructions?: string | null;
  status: OrderStatus;
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus;
  subtotalPaise: number;
  taxPaise: number;
  taxLabel?: string;
  deliveryFeePaise: number;
  totalPaise: number;
  items: OrderItemSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  notes?: string;
}
