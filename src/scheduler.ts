/**
 * 控制真正的服务器端定时任务（Cloud Scheduler），不是浏览器 setInterval 那套——
 * 那套只在浏览器标签页开着的时候才跑，关掉标签页/合上电脑就停了，客户体验上是个假的定时功能。
 * 这里通过 googleapis 的 cloudscheduler v1 客户端直接读写那个 Cloud Scheduler 任务的 cron 表达式。
 *
 * 认证跟 sheets/client.ts 一样走 ADC，本地开发用自建 OAuth 客户端登录时候要过的 cloud-platform
 * scope 已经够用（Cloud Scheduler 是标准 GCP API，不像 Sheets/Drive 那样需要额外的用户数据 scope）。
 */
import { google, type cloudscheduler_v1 } from 'googleapis';

const PROJECT = process.env.GCP_PROJECT || 'draye-mvp';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';
const JOB_NAME = process.env.SCHEDULER_JOB_NAME || 'draye-track-all';
const JOB_PATH = `projects/${PROJECT}/locations/${LOCATION}/jobs/${JOB_NAME}`;

export const SCHEDULE_HOUR_OPTIONS = [1, 2, 4, 8] as const;

let cachedClient: cloudscheduler_v1.Cloudscheduler | null = null;

async function getClient(): Promise<cloudscheduler_v1.Cloudscheduler> {
  if (cachedClient) return cachedClient;
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  cachedClient = google.cloudscheduler({ version: 'v1', auth: client as any });
  return cachedClient;
}

/** 只认 "0 *​/N * * *" 这种"每 N 小时整点跑一次"的格式——跟 setScheduleHours 写进去的格式对上就行，不用支持任意 cron。 */
const CRON_PATTERN = /^0 \*\/(\d+) \* \* \*$/;

export interface ScheduleState {
  hours: number | null;
  enabled: boolean;
}

export async function getSchedule(): Promise<ScheduleState> {
  const scheduler = await getClient();
  const res = await scheduler.projects.locations.jobs.get({ name: JOB_PATH });
  const match = (res.data.schedule ?? '').match(CRON_PATTERN);
  return {
    hours: match ? parseInt(match[1], 10) : null,
    enabled: res.data.state === 'ENABLED',
  };
}

export async function setScheduleHours(hours: number): Promise<void> {
  const scheduler = await getClient();
  await scheduler.projects.locations.jobs.patch({
    name: JOB_PATH,
    updateMask: 'schedule',
    requestBody: { schedule: `0 */${hours} * * *` },
  });
  // patch 不保证会把已暂停的任务恢复成运行状态，显式 resume 一下确保生效
  await scheduler.projects.locations.jobs.resume({ name: JOB_PATH }).catch(() => {});
}

export async function pauseSchedule(): Promise<void> {
  const scheduler = await getClient();
  await scheduler.projects.locations.jobs.pause({ name: JOB_PATH });
}
