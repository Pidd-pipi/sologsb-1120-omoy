import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { claimStep, invalidateValidTests, recoverPendingHandovers } from '../utils/handover';
import { notifyChanged } from '../utils/sync';
import type { RepairStep, RepairStepDraft } from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';
import type { HandoverRecord } from '../types/handover';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  handovers: HandoverRecord[];
  loaded: boolean;
}

export const useStepStore = defineStore('step', {
  state: (): StepState => ({ items: [], tests: [], handovers: [], loaded: false }),
  getters: {
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => a.seq - b.seq),
    testsByClock: (state) => (clockId: string) =>
      state.tests.filter((it) => it.clockId === clockId).sort((a, b) => b.testedAt - a.testedAt),
    /** 有效测试（已作废的不计入台账分栏与判定） */
    validTestsByClock: (state) => (clockId: string) =>
      state.tests
        .filter((it) => it.clockId === clockId && it.state !== 'stale')
        .sort((a, b) => b.testedAt - a.testedAt),
    /** 写库失败/中断、待恢复的交接 */
    pendingHandovers: (state) =>
      state.handovers.filter((h) => h.status === 'pending' || h.status === 'failed'),
  },
  actions: {
    async load() {
      const steps = await db.steps.toArray();
      steps.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
      this.items = steps;
      const tests = await db.tests.toArray();
      this.tests = tests.sort((a, b) => b.testedAt - a.testedAt);
      this.handovers = (await db.handovers.toArray()).sort((a, b) => b.createdAt - a.createdAt);
      this.loaded = true;
    },
    /**
     * 新建工序：顺序号在事务内重读校验。
     * 两台修复台同时保存时，后到的事务看到先到的结果，报明确错误而不是覆盖。
     * 创建人即认领人；新工序视同工序改动，作废该钟表有效测试。
     */
    async add(draft: RepairStepDraft) {
      const now = Date.now();
      const record: RepairStep = {
        ...toPlain(draft),
        id: newId('stp'),
        claimedBy: draft.operator,
        claimedAt: now,
        handoverVersion: 1,
      };
      await db.transaction('rw', db.steps, db.tests, async () => {
        const siblings = await db.steps.where('clockId').equals(record.clockId).toArray();
        if (siblings.some((s) => s.seq === record.seq)) {
          throw new Error(`顺序号 ${record.seq} 已被占用（可能另一台修复台刚保存），请刷新后重试`);
        }
        const maxSeq = siblings.reduce((m, s) => Math.max(m, s.seq), 0);
        if (record.seq > maxSeq + 1) {
          throw new Error(`顺序号跳号：当前最大顺序号为 ${maxSeq}，新步骤必须用 ${maxSeq + 1}`);
        }
        await db.steps.put(toPlain(record));
        await invalidateValidTests(record.clockId, record.id);
      });
      await this.load();
      notifyChanged();
      return record;
    },
    /**
     * 认领/交接工序：只有一个人能成功；
     * 晚到的一边抛 HandoverConflictError（含接走人），开始时间不动。
     */
    async claim(stepId: string, operator: string) {
      const local = this.items.find((it) => it.id === stepId);
      try {
        const updated = await claimStep({
          stepId,
          operator,
          expectedVersion: local?.handoverVersion ?? 0,
        });
        notifyChanged();
        return updated;
      } finally {
        // 冲突时同样刷新：立即把当前持有人与版本号同步到界面
        await this.load();
      }
    },
    async finish(id: string) {
      await db.transaction('rw', db.steps, db.tests, async () => {
        const step = await db.steps.get(id);
        if (!step) throw new Error('工序不存在或已被删除');
        await db.steps.update(id, { state: 'done', finishedAt: Date.now() });
        await invalidateValidTests(step.clockId, id);
      });
      await this.load();
      notifyChanged();
    },
    async rollback(id: string) {
      await db.transaction('rw', db.steps, db.tests, async () => {
        const step = await db.steps.get(id);
        if (!step) throw new Error('工序不存在或已被删除');
        await db.steps.update(id, { state: 'rolledback', finishedAt: undefined });
        await invalidateValidTests(step.clockId, id);
      });
      await this.load();
      notifyChanged();
    },
    /** 上下移动排序：交换两个相邻步骤的 seq（同事务，并作废相关测试） */
    async swapSeq(aId: string, bId: string) {
      await db.transaction('rw', db.steps, db.tests, async () => {
        const a = await db.steps.get(aId);
        const b = await db.steps.get(bId);
        if (!a || !b) return;
        await db.steps.update(a.id, { seq: b.seq });
        await db.steps.update(b.id, { seq: a.seq });
        const clockIds = Array.from(new Set([a.clockId, b.clockId]));
        for (const clockId of clockIds) {
          await invalidateValidTests(clockId, aId);
        }
      });
      await this.load();
      notifyChanged();
    },
    async addTest(draft: TimekeepingTestDraft) {
      const record: TimekeepingTest = { ...toPlain(draft), id: newId('tst'), state: 'valid' };
      await db.tests.put(toPlain(record));
      await this.load();
      notifyChanged();
      return record;
    },
    async removeTest(id: string) {
      await db.tests.delete(id);
      await this.load();
      notifyChanged();
    },
    /** 恢复写库失败/中断的交接（重放 pending/failed 日志） */
    async recoverHandovers() {
      const result = await recoverPendingHandovers();
      await this.load();
      notifyChanged();
      return result;
    },
  },
});
