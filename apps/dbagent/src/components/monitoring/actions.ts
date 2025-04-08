'use server';

import { anthropic } from '@ai-sdk/anthropic';
import { createDeepSeek, deepseek } from '@ai-sdk/deepseek';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { auth } from '~/auth';
import { getScheduleRuns, ScheduleRun } from '~/lib/db/schedule-runs';
import {
  deleteSchedule,
  getSchedule,
  getSchedules,
  insertSchedule,
  Schedule,
  updateSchedule,
  updateScheduleRunData
} from '~/lib/db/schedules';
import { env } from '~/lib/env/server';
import { scheduleGetNextRun, utcToLocalDate } from '~/lib/monitoring/scheduler';
import { listPlaybooks } from '~/lib/tools/playbooks';

export async function generateCronExpression(description: string): Promise<string> {
  const prompt = `Generate a cron expression for the following schedule description: "${description}". 
  Return strictly the cron expression, no quotes or anything else.`;

  let model;

  if (env.CRON_MODEL_TYPE === 'deepseek') {
    if (env.CRON_MODEL_URL) {
      model = createDeepSeek({
        baseURL: env.CRON_MODEL_URL,
        apiKey: env.CRON_MODEL_KEY
      })(env.CRON_MODEL_NAME || 'deepseek-chat');
    } else {
      model = deepseek(env.CRON_MODEL_NAME || 'deepseek-chat');
    }
  } else if (env.CRON_MODEL_TYPE === 'openai') {
    model = openai(env.CRON_MODEL_NAME || 'gpt-3.5-turbo');
  } else if (env.CRON_MODEL_TYPE === 'anthropic') {
    model = anthropic(env.CRON_MODEL_NAME || 'claude-3-haiku');
  } else {
    model = deepseek(env.CRON_MODEL_NAME || 'deepseek-chat');
  }

  const { text } = await generateText({
    model,
    prompt: prompt
  });

  return text.trim();
}

export async function actionCreateSchedule(schedule: Omit<Schedule, 'id' | 'userId'>): Promise<Schedule> {
  const session = await auth();
  const userId = session?.user?.id ?? '';
  if (schedule.enabled) {
    schedule.status = 'scheduled';
    schedule.nextRun = scheduleGetNextRun({ ...schedule, userId }, new Date()).toISOString();
  }
  return insertSchedule({ ...schedule, userId });
}

export async function actionUpdateSchedule(schedule: Omit<Schedule, 'userId'>): Promise<Schedule> {
  const session = await auth();
  const userId = session?.user?.id ?? '';
  return updateSchedule({ ...schedule, userId });
}

export async function actionGetSchedules(): Promise<Schedule[]> {
  const schedules = await getSchedules();
  // Ensure last_run is serialized as string
  schedules.forEach((schedule) => {
    if (schedule.lastRun) {
      schedule.lastRun = utcToLocalDate(schedule.lastRun).toString();
    }
    if (schedule.nextRun) {
      schedule.nextRun = utcToLocalDate(schedule.nextRun).toString();
    }
  });
  return schedules;
}

export async function actionGetSchedule(id: string): Promise<Schedule> {
  return getSchedule(id);
}

export async function actionDeleteSchedule(id: string): Promise<void> {
  return deleteSchedule(id);
}

export async function actionListPlaybooks(): Promise<string[]> {
  return listPlaybooks();
}

export async function actionUpdateScheduleEnabled(scheduleId: string, enabled: boolean) {
  if (enabled) {
    const schedule = await getSchedule(scheduleId);
    schedule.enabled = true;
    schedule.status = 'scheduled';
    schedule.nextRun = scheduleGetNextRun(schedule, new Date()).toUTCString();
    console.log('nextRun', schedule.nextRun);
    await updateScheduleRunData(schedule);
  } else {
    const schedule = await getSchedule(scheduleId);
    schedule.enabled = false;
    schedule.status = 'disabled';
    schedule.nextRun = undefined;
    await updateScheduleRunData(schedule);
  }
}

export async function actionGetScheduleRuns(scheduleId: string): Promise<ScheduleRun[]> {
  return getScheduleRuns(scheduleId);
}
