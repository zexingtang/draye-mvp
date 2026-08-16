/**
 * 人类行为模拟工具（降低被识别为自动化脚本的概率）
 */

import type { Page } from 'playwright';
import { randomDelay } from './delays.js';

export async function simulateHumanBehavior(page: Page): Promise<void> {
  const moves = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < moves; i++) {
    await page.mouse.move(Math.random() * 800, Math.random() * 600, { steps: 10 });
    await randomDelay(100, 300);
  }

  if (Math.random() > 0.5) {
    await page.evaluate(() => {
      window.scrollBy({ top: Math.random() * 300, behavior: 'smooth' });
    });
    await randomDelay(500, 1000);
  }
}

export function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}
