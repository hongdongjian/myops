import { z } from 'zod';

export const QX_GROUPS = [
  'general',
  'task_local',
  'rewrite_remote',
  'http_backend',
  'filter_remote',
  'server_remote',
  'images',
] as const;
export type QxGroup = (typeof QX_GROUPS)[number];

export const QxGroupSchema = z.enum(QX_GROUPS);

export const QxConfigSchema = z.object({
  api_key: z.string().optional(),
  public_base_url: z.string().optional(),
});
export type QxConfig = z.infer<typeof QxConfigSchema>;

export const QxResourceSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1),
  source: z.enum(['remote', 'manual']),
  size: z.number().int().min(0).optional(),
  updatedAt: z.number().int().optional(),
  error: z.string().optional(),
});
export type QxResource = z.infer<typeof QxResourceSchema>;

export type QxManifest = Record<QxGroup, QxResource[]>;

export function emptyManifest(): QxManifest {
  return {
    general: [],
    task_local: [],
    rewrite_remote: [],
    http_backend: [],
    filter_remote: [],
    server_remote: [],
    images: [],
  };
}

export const RefreshBodySchema = z.object({
  group: QxGroupSchema.optional(),
  url: z.string().url().optional(),
});
export type RefreshBody = z.infer<typeof RefreshBodySchema>;

export const AddBodySchema = z.object({
  group: QxGroupSchema,
  url: z.string().url(),
});

export const DeleteBodySchema = z.object({
  group: QxGroupSchema,
  filename: z.string().min(1),
});

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}
