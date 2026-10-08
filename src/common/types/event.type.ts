import { EventName } from "../constants/event.constant";

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  fullName?: string | null;
  verifyToken: string;
}

export interface VerificationRequestedPayload {
  userId: string;
  email: string;
  fullName?: string | null;
  verifyToken: string;
}

export interface PasswordResetRequestedPayload {
  userId: string;
  email: string;
  resetToken: string;
  ip?: string | null;
}

export interface NewDeviceDetectedPayload {
  userId: string;
  email: string;
  deviceName: string;
  ip?: string | null;
}

export interface DeactivationRequestedPayload {
  userId: string;
  email: string;
  fullName?: string | null;
  deactivationToken: string;
}

export interface UserSoftDeletedPayload {
  userId: string;
  deletedBy?: string | null;
  deletedAt: string | Date;
}

export interface FileUploadedUnconfirmedPayload {
  fileId: string;
  key: string;
  bucket: string;
  expiresAt: string | Date;
}

export interface EventPayloadMap {
  "auth.user_registered": UserRegisteredPayload;
  "auth.verification_requested": VerificationRequestedPayload;
  "auth.password_reset_requested": PasswordResetRequestedPayload;
  "auth.new_device_detected": NewDeviceDetectedPayload;
  "auth.deactivation_requested": DeactivationRequestedPayload;
  "user.soft_deleted": UserSoftDeletedPayload;
  "file.uploaded_unconfirmed": FileUploadedUnconfirmedPayload;
}

export interface EventEnvelope<T = unknown> {
  id: string; // UUIDv7 duy nhất đại diện cho sự kiện
  name: EventName;
  payload: T;
  aggregateId?: string | null;
  timestamp: number;
  traceId?: string;
  source: string;
}

export type EventHandler<T = any> = (
  event: EventEnvelope<T>,
) => Promise<void> | void;
