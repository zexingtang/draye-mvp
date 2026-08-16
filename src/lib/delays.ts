/**
 * 随机延迟工具函数
 */

import type { DelayConfig } from '../carriers/base.js';

export function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function delayWithConfig(config: DelayConfig): Promise<void> {
  return randomDelay(config.min, config.max);
}
