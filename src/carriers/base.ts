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

/** 抓取进度回调的一次上报——每抓完一个批次调一次，用于前端进度条实时显示。累计值。 */
export interface CrawlProgress {
  /** 已完成的批次数 */
  batchesDone: number;
  /** 总批次数 */
  totalBatches: number;
  /** 已处理的箱号数（累计） */
  processed: number;
  /** 总箱号数 */
  total: number;
  /** 累计：抓到数据的 */
  found: number;
  /** 累计：查无此箱的 */
  notFound: number;
  /** 累计：真实错误的（超时/页面异常/整批空等） */
  errored: number;
}

export type CrawlProgressCallback = (progress: CrawlProgress) => void;

/** 每个 carrier 适配器都要实现这个接口 */
export interface CarrierCrawler {
  crawl(containerList: string[], onProgress?: CrawlProgressCallback): Promise<ContainerResult[]>;
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
