import { db } from './db';
import { newId } from './id';
import type { HandoverRecord } from '../types/handover';
import type { RepairStep } from '../types/step';

/** 认领冲突：晚到一步，错误里带上实际持有人与接走时间，方便界面明示 */
export class HandoverConflictError extends Error {
  readonly holder: string;
  readonly holderClaimedAt: number;

  constructor(holder: string, holderClaimedAt: number) {
    super(`该工序已被 ${holder || '他人'} 接走`);
    this.name = 'HandoverConflictError';
    this.holder = holder;
    this.holderClaimedAt = holderClaimedAt;
  }
}

/**
 * 作废某钟表的全部有效走时测试。
 * 工序一改动即触发，必须在 steps/tests 的 rw 事务内调用，与工序写库同生共死。
 * 返回作废条数。
 */
export async function invalidateValidTests(clockId: string, stepId: string): Promise<number> {
  const now = Date.now();
  return db.tests
    .where('clockId')
    .equals(clockId)
    .filter((t) => (t.state ?? 'valid') === 'valid')
    .modify({ state: 'stale', invalidatedAt: now, invalidatedByStep: stepId });
}

export interface ClaimInput {
  stepId: string;
  /** 认领人 */
  operator: string;
  /** 认领方看到的交接版本号（乐观锁） */
  expectedVersion: number;
}

/**
 * 认领/交接工序：
 * 1. 先落一条 pending 交接日志——即使后续写库失败，这次交接也能据此恢复；
 * 2. 再执行认领事务。同一时刻只有一个人能认领成功；
 *    晚到的一边抛 HandoverConflictError（含接走人姓名与时间）；
 * 3. 交接只换持有人与版本号，startedAt 不动。
 */
export async function claimStep(input: ClaimInput): Promise<RepairStep> {
  const step = await db.steps.get(input.stepId);
  if (!step) throw new Error('工序不存在或已被删除');
  const record: HandoverRecord = {
    id: newId('hov'),
    stepId: step.id,
    clockId: step.clockId,
    fromOperator: step.claimedBy ?? '',
    toOperator: input.operator,
    expectedVersion: input.expectedVersion,
    status: 'pending',
    createdAt: Date.now(),
  };
  await db.handovers.put(record);
  try {
    return await applyHandover(record);
  } catch (err) {
    // 冲突日志已在认领事务内标记 rejected，直接上抛
    if (err instanceof HandoverConflictError) throw err;
    // 其余为写库失败：标记 failed，等待恢复重放
    await db.handovers.update(record.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

interface HandoverTxResult {
  step?: RepairStep;
  conflict?: { holder: string; holderClaimedAt: number };
}

/**
 * 认领事务：冲突时只把日志标为 rejected 并正常返回（不抛错），
 * 否则抛错会回滚事务，rejected 标记落不了库、残留的 pending 日志还会被恢复流程误重放。
 */
async function runHandoverTx(record: HandoverRecord): Promise<HandoverTxResult> {
  return db.transaction('rw', db.steps, db.tests, db.handovers, async () => {
    const step = await db.steps.get(record.stepId);
    if (!step) throw new Error('工序不存在或已被删除');

    if (step.claimedBy === record.toOperator && step.handoverVersion > record.expectedVersion) {
      await db.handovers.update(record.id, { status: 'applied', resolvedAt: Date.now() });
      return { step };
    }
    if (step.handoverVersion !== record.expectedVersion) {
      await db.handovers.update(record.id, {
        status: 'rejected',
        holder: step.claimedBy ?? '',
        resolvedAt: Date.now(),
      });
      return { conflict: { holder: step.claimedBy ?? '', holderClaimedAt: step.claimedAt ?? 0 } };
    }

    const patch: Pick<RepairStep, 'claimedBy' | 'claimedAt' | 'handoverVersion'> = {
      claimedBy: record.toOperator,
      claimedAt: Date.now(),
      handoverVersion: step.handoverVersion + 1,
    };
    await db.steps.update(step.id, patch);
    await invalidateValidTests(step.clockId, step.id);
    await db.handovers.update(record.id, { status: 'applied', resolvedAt: Date.now() });
    return { step: { ...step, ...patch } };
  });
}

/**
 * 认领事务本体（可重放、幂等）：
 * - 交接版本号与认领方看到的不一致 → 期间已被别人接走，抛 HandoverConflictError；
 * - 已被同一认领人接走且版本已推进 → 视为成功（恢复重放安全）。
 * 同事务内作废该钟表的有效走时测试。
 */
export async function applyHandover(record: HandoverRecord): Promise<RepairStep> {
  const result = await runHandoverTx(record);
  if (result.conflict) {
    // 事务已提交（rejected 标记落库），再抛错通知调用方
    throw new HandoverConflictError(result.conflict.holder, result.conflict.holderClaimedAt);
  }
  return result.step as RepairStep;
}

/**
 * 恢复未写入成功的交接（pending/failed 日志逐条重放）。
 * 启动时与台账页「恢复交接」按钮都会调用；冲突的日志已被别人接走，无需再恢复。
 */
export async function recoverPendingHandovers(): Promise<{ recovered: number; failed: number }> {
  const pendings = await db.handovers.where('status').anyOf('pending', 'failed').sortBy('createdAt');
  let recovered = 0;
  let failed = 0;
  for (const rec of pendings) {
    try {
      await applyHandover(rec);
      recovered += 1;
    } catch (err) {
      if (err instanceof HandoverConflictError) {
        recovered += 1; // 工序已有归属，日志已标 rejected，视为了结
      } else {
        failed += 1;
        await db.handovers.update(rec.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return { recovered, failed };
}
