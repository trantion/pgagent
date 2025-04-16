/* eslint-disable no-process-env */
import 'server-only';
import { z } from 'zod';
import { env as clientEnv } from './client';

const schema = z.object({
  // The URL of the database that we use to store data
  DATABASE_URL: z.string(),

  // NextAuth configuration
  NEXTAUTH_URL: z.string().optional(),
  NEXTAUTH_TRUST_HOST: z.string().optional().default('false'),

  // The OpenID client settings
  AUTH_SECRET: z.string().optional(),
  AUTH_OPENID_ID: z.string().optional(),
  AUTH_OPENID_SECRET: z.string().optional(),
  AUTH_OPENID_ISSUER: z.string().optional(),

  // LLM API credentials
  OPENAI_API_KEY: z.string(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_URL: z.string().optional(),
  DEEPSEEK_NAME: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Cron task model configuration
  CRON_MODEL_TYPE: z.string().optional().default('deepseek'),
  CRON_MODEL_NAME: z.string().optional().default('deepseek-chat'),
  CRON_MODEL_URL: z.string().optional(),
  CRON_MODEL_KEY: z.string().optional(),

  // Scheduler
  MAX_PARALLEL_RUNS: z.number().default(20), // How many schedules can be run in parallel
  TIMEOUT_FOR_RUNNING_SCHEDULE_SECS: z.number().default(15 * 60), // How long to wait before assuming it's dead and restart

  EVAL: z.string(z.enum(['true', 'false'])).default('false')
});

const serverEnv = schema.parse(process.env);

export const env = { ...clientEnv, ...serverEnv };
