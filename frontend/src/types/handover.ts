/** 交接意图状态 */
export type HandoverStatus = 'pending' | 'done' | 'failed';

/**
 * 工序交接意图（交接箱 / outbox）。
 *
 * 认领工序前先以独立事务写入一条 pending 意图，再执行认领事务：
 * 即便随后的业务写入失败（掉电、标签页被杀、IndexedDB 异常），
 * 意图仍留在库里，可由本人或下次启动时「恢复这次交接」。
 */
export interface Handover {
  id: string;
  /** 目标工序 */
  stepId: string;
  clockId: string;
  /** 交接人（点击认领的修复师） */
  owner: string;
  /** 顺序号快照，便于恢复时核对 */
  seq: number;
  stepType: string;
  createdAt: number;
  /** 最近一次尝试时间 */
  lastTryAt?: number;
  /** 认领成功时间 */
  finishedAt?: number;
  /** 最近一次失败原因 */
  lastError?: string;
  status: HandoverStatus;
  /** 尝试次数 */
  attempts: number;
}

export type HandoverDraft = Omit<Handover, 'id' | 'createdAt' | 'attempts' | 'status'>;
