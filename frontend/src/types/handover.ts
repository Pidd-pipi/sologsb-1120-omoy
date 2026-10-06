/** 交接日志状态 */
export type HandoverStatus =
  /** 已登记、尚未写入工序（崩溃/失败后可恢复重放） */
  | 'pending'
  /** 认领成功，已写入工序 */
  | 'applied'
  /** 认领冲突：晚到一步，工序已被别人接走 */
  | 'rejected'
  /** 写库失败，等待恢复 */
  | 'failed';

/**
 * 工序交接日志（outbox）：
 * 认领前先落一条 pending 日志，再执行认领事务；
 * 写库失败或中途崩溃时，依据 pending/failed 日志恢复这次交接。
 */
export interface HandoverRecord {
  id: string;
  stepId: string;
  clockId: string;
  /** 交出人（认领前持有人） */
  fromOperator: string;
  /** 认领人 */
  toOperator: string;
  /** 认领方看到的交接版本号（乐观锁） */
  expectedVersion: number;
  status: HandoverStatus;
  /** 冲突时的实际持有人 */
  holder?: string;
  /** 写库失败原因 */
  error?: string;
  createdAt: number;
  resolvedAt?: number;
}
