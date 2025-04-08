'use server';

import { createDeepSeek, deepseek } from '@ai-sdk/deepseek';
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

  const { text } = await generateText({
    model: env.DEEPSEEK_LOCAL_URL
      ? createDeepSeek({ baseURL: env.DEEPSEEK_LOCAL_URL })(env.DEEPSEEK_LOCAL_MODEL || 'deepseek-chat')
      : deepseek(env.DEEPSEEK_LOCAL_MODEL || 'deepseek-chat'),
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
