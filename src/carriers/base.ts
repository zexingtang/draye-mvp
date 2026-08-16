/**
 * 统一 Carrier 抓取接口 —— 所有 carrier 适配器都要实现这个形状。
 * 加新 carrier 只需要新增一个适配器文件并注册，不改动其他代码。
 */

export interface ContainerResult {
  /** 集装箱号 */
  cntr: string;
  /** 预计到达日期 */
  eta_date: string | null;
  /** 预计到达时间 */
  eta_time: string | null;
  /** 错误信息（如果有） */
  error?: string;
  /** 额外数据（不同 carrier 可能有不同字段，例如 storage_last_free_day） */
  extra?: Record<string, any>;
}

export interface RailConfig {
  url: string;
  username: string;
  password: string;
}

export interface CrawlerOptions {
  defaultTimeout?: number;
  navigationTimeout?: number;
  selectorTimeout?: number;
  enableRandomDelays?: boolean;
  simulateHumanBehavior?: boolean;
}

export interface DelayConfig {
  min: number;
  max: number;
}

export interface DelayConfigs {
  beforeLogin: DelayConfig;
  afterLogin: DelayConfig;
  betweenQueries: DelayConfig;
  afterQuery: DelayConfig;
}

/** 每个 carrier 适配器都要实现这个接口 */
export interface CarrierCrawler {
  crawl(containerList: string[]): Promise<ContainerResult[]>;
}

export class CrawlerError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly container?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'CrawlerError';
  }
}
