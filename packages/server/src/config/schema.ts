import { z } from 'zod';

export const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3839),
  copilot_proxy_url: z.string().url().optional(),
  models: z.array(z.string()).default([]),
}).passthrough();

export type Config = Readonly<z.infer<typeof ConfigSchema>>;
