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
  isActive: boolean;
  createdAt: string;
}
