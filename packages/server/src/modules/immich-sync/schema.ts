import { z } from 'zod';

export const ImmichAddAccountRequestSchema = z.object({
  name: z.string().default(''),
  apiKey: z.string().min(1),
  baseUrl: z.string().default(''),
});
export type ImmichAddAccountRequest = z.infer<typeof ImmichAddAccountRequestSchema>;

export const ImmichAccountIDRequestSchema = z.object({ id: z.string().min(1) });
export const ImmichPlanIDRequestSchema = z.object({ id: z.string().min(1) });

export const ImmichCreateAlbumRequestSchema = z.object({ name: z.string().min(1) });

export const ImmichCreatePlanRequestSchema = z.object({
  name: z.string().min(1),
  accountId: z.string().default(''),
  personIds: z.array(z.string()).min(1),
  personNames: z.array(z.string()).default([]),
  albumId: z.string().min(1),
  albumName: z.string().default(''),
  removeDeleted: z.boolean().default(false),
  enabled: z.boolean().default(false),
  scheduleInterval: z.number().int().default(0),
});
export type ImmichCreatePlanRequest = z.infer<typeof ImmichCreatePlanRequestSchema>;

export const ImmichUpdatePlanRequestSchema = ImmichCreatePlanRequestSchema.extend({
  id: z.string().min(1),
});
export type ImmichUpdatePlanRequest = z.infer<typeof ImmichUpdatePlanRequestSchema>;

export interface ImmichConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ImmichAccount {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  baseUrl: string;
}

export interface ImmichSyncStats {
  added: number;
  removed: number;
  total: number;
}

export interface ImmichSyncPlan {
  id: string;
  accountId?: string;
  name: string;
  personIds: string[];
  personNames: string[];
  albumId: string;
  albumName: string;
  removeDeleted: boolean;
  enabled: boolean;
  scheduleInterval: number;
  status: string;
  lastRunAt?: string;
  lastRunDate?: string;
  lastRunStats?: ImmichSyncStats;
  errorMsg?: string;
}

export interface ImmichSyncProgress {
  planId: string;
  running: boolean;
  phase: string;
  total: number;
  done: number;
  added: number;
  removed: number;
  startedAt: string;
}

export interface ImmichPerson {
  id: string;
  name: string;
  isHidden: boolean;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
}

export interface ImmichCurrentUser {
  id: string;
  name: string;
  email: string;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export const DEFAULT_IMMICH_BASE_URL = 'http://localhost:2283';
export const IMMICH_TICK_INTERVAL_MS = 5_000;
export const IMMICH_BATCH_SIZE = 500;
export const IMMICH_SEARCH_PAGE_SIZE = 500;
