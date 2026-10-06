import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { broadcastChange } from '../utils/sync';
import { StepAlreadyClaimedError } from '../types/step';
import type { Handover } from '../types/handover';
import { useStepStore } from './stepStore';

interface HandoverState {
  items: Handover[];
  loaded: boolean;
}

/** 交接（认领）一次尝试的结果 */
export type HandoverOutcome =
  | { ok: true; handover: Handover; owner: string; voidedTests: number }
  | { ok: false; handover: Handover; conflict: true; owner: string }
  | { ok: false; handover: Handover; conflict: false; error: string };

export const useHandoverStore = defineStore('handover', {
  state: (): HandoverState => ({ items: [], loaded: false }),
  getters: {
    /** 尚未完成、可恢复的交接意图 */
    pending: (state) =>
      state.items
        .filter((it) => it.status !== 'done')
        .sort((a, b) => b.createdAt - a.createdAt),
    byStep: (state) => (stepId: string) =>
      state.items.find((it) => it.stepId === stepId && it.status !== 'done'),
  },
  actions: {
    async load() {
      this.items = await db.handovers.orderBy('createdAt').reverse().toArray();
      this.loaded = true;
    },

    /**
     * 认领工序（带失败恢复的交接）。
     *
     * 第一步用独立事务把「交接意图」写入 handovers（outbox 模式）；
     * 第二步才执行原子认领。若第二步因写入失败中断（掉电 / 标签页被杀 /
     * 浏览器异常），pending 意图仍在，可通过 recover 恢复这次交接；
     * 若第二步明确发现已被他人接走，则意图置 failed 并回报接走人。
     */
    async request(stepId: string, owner: string): Promise<HandoverOutcome> {
      const who = owner.trim();
      if (!who) throw new Error('认领人必填');

      // 同一工序已有未完成意图时直接复用，避免重复登记
      const existed = this.items.find((it) => it.stepId === stepId && it.status !== 'done');
      let handover: Handover;
      if (existed && existed.owner === who) {
        handover = existed;
      } else if (existed) {
        return {
          ok: false,
          handover: existed,
          conflict: true,
          owner: existed.owner,
        };
      } else {
        const stepStore = useStepStore();
        const step = stepStore.byId(stepId);
        handover = {
          id: newId('hnd'),
          stepId,
          clockId: step?.clockId ?? '',
          owner: who,
          seq: step?.seq ?? 0,
          stepType: step?.stepType ?? '',
          createdAt: Date.now(),
          attempts: 0,
          status: 'pending',
        };
        await db.handovers.put(toPlain(handover));
        this.items = [handover, ...this.items];
      }

      return this.recover(handover.id);
    },

    /**
     * 恢复一次交接：重新执行原子认领。
     * - 认领成功（含此前已写入成功只是来不及标记）→ 意图置 done
     * - 已被别人接走 → 意图置 failed（终态），回报接走人
     * - 其他写入失败 → 意图保留 pending，记录错误，等待再次恢复
     */
    async recover(handoverId: string): Promise<HandoverOutcome> {
      const handover = await db.handovers.get(handoverId);
      if (!handover) throw new Error('交接记录不存在');
      if (handover.status === 'done') {
        return { ok: true, handover, owner: handover.owner, voidedTests: 0 };
      }

      const stepStore = useStepStore();
      try {
        const result = await stepStore.claim(handover.stepId, handover.owner);
        const done: Handover = {
          ...handover,
          status: 'done',
          finishedAt: Date.now(),
          attempts: handover.attempts + 1,
          lastTryAt: Date.now(),
          lastError: undefined,
        };
        await db.handovers.put(done);
        this.upsert(done);
        broadcastChange('handovers', 'recover-done');
        return {
          ok: true,
          handover: done,
          owner: handover.owner,
          voidedTests: result.voidedTests,
        };
      } catch (err) {
        const now = Date.now();
        if (err instanceof StepAlreadyClaimedError) {
          // 别人接走：本次交接无法再由本人完成，置终态
          const failed: Handover = {
            ...handover,
            status: 'failed',
            lastTryAt: now,
            attempts: handover.attempts + 1,
            lastError: `已被 ${err.owner} 接走`,
          };
          await db.handovers.put(failed);
          this.upsert(failed);
          broadcastChange('handovers', 'recover-conflict');
          return { ok: false, handover: failed, conflict: true, owner: err.owner };
        }
        // 写入失败：意图保留为 pending，下次可恢复这次交接
        const retry: Handover = {
          ...handover,
          status: 'pending',
          lastTryAt: now,
          attempts: handover.attempts + 1,
          lastError: err instanceof Error ? err.message : String(err),
        };
        await db.handovers.put(retry);
        this.upsert(retry);
        broadcastChange('handovers', 'recover-retry');
        return { ok: false, handover: retry, conflict: false, error: retry.lastError ?? '写入失败' };
      }
    },

    /** 启动时恢复所有「写入失败」的交接；已确认被他人接走的 failed 不自动重试 */
    async recoverAllPending(): Promise<void> {
      const pending = await db.handovers.where('status').equals('pending').toArray();
      for (const h of pending) {
        await this.recover(h.id);
      }
    },

    async dismiss(id: string) {
      await db.handovers.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
      broadcastChange('handovers', 'dismiss');
    },

    upsert(handover: Handover) {
      const exists = this.items.some((it) => it.id === handover.id);
      this.items = exists
        ? this.items.map((it) => (it.id === handover.id ? handover : it))
        : [handover, ...this.items];
    },
  },
});
