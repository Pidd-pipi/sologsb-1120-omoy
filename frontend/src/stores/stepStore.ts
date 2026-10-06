import { defineStore } from 'pinia';
import { db, toPlain, voidTestsInTx } from '../utils/db';
import { newId } from '../utils/id';
import { broadcastChange } from '../utils/sync';
import {
  SeqConflictError,
  StepAlreadyClaimedError,
  type RepairStep,
  type RepairStepDraft,
} from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  loaded: boolean;
}

export interface ClaimResult {
  step: RepairStep;
  /** 本次认领连带作废的走时测试条数 */
  voidedTests: number;
}

export const useStepStore = defineStore('step', {
  state: (): StepState => ({ items: [], tests: [], loaded: false }),
  getters: {
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => a.seq - b.seq),
    testsByClock: (state) => (clockId: string) =>
      state.tests
        .filter((it) => it.clockId === clockId)
        .sort((a, b) => b.testedAt - a.testedAt),
    /** 仍有效的走时测试（已作废的不计入台账与走时单判定） */
    validTestsByClock: (state) => (clockId: string) =>
      state.tests
        .filter((it) => it.clockId === clockId && !it.voided)
        .sort((a, b) => b.testedAt - a.testedAt),
    byId: (state) => (id: string) => state.items.find((it) => it.id === id),
  },
  actions: {
    async load() {
      const steps = await db.steps.toArray();
      steps.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
      this.items = steps;
      const tests = await db.tests.toArray();
      this.tests = tests.sort((a, b) => b.testedAt - a.testedAt);
      this.loaded = true;
    },

    /**
     * 互斥认领（工序交接）。
     *
     * 读—判定—写全部在同一个 IndexedDB 读事务内完成；同源多个标签页（两台修复台）
     * 的写事务由浏览器串行化，因此 claimOwner 的「空→非空」是一次真正的比较并交换，
     * 只会有一方成功。startedAt 自始至终不动；晚到方拿到 StepAlreadyClaimedError，
     * 其中带有已接走责任人。同一事务内把该钟的有效走时测试作废。
     */
    async claim(id: string, owner: string): Promise<ClaimResult> {
      const who = owner.trim();
      if (!who) throw new Error('认领人必填');
      const result = await db.transaction('rw', db.steps, db.tests, async () => {
        const step = await db.steps.get(id);
        if (!step) throw new Error('工序不存在或已被删除');
        if (step.claimOwner) {
          if (step.claimOwner === who) {
            // 同一人重复提交（典型场景：恢复上次已写入成功、却没来得及收尾的交接）→ 幂等成功
            return { step, voidedTests: 0 };
          }
          throw new StepAlreadyClaimedError(step.claimOwner, step.claimedAt ?? 0);
        }
        const now = Date.now();
        const claimed: RepairStep = { ...step, claimOwner: who, claimedAt: now };
        await db.steps.put(claimed);
        const voidedTests = await voidTestsInTx(
          db.tests,
          step.clockId,
          `工序 #${step.seq} ${step.stepType} 被 ${who} 认领`,
        );
        return { step: claimed, voidedTests };
      });

      this.items = this.items.map((it) => (it.id === id ? result.step : it));
      if (result.voidedTests > 0) {
        await this.reloadTestsForClock(result.step.clockId);
      }
      broadcastChange('steps', 'claim');
      return result;
    },

    async add(draft: RepairStepDraft) {
      const now = Date.now();
      const record: RepairStep = {
        ...toPlain(draft),
        // 新建即由登记责任人接走；claimOwner 只由这一处首写，之后仅互斥认领可改
        claimOwner: draft.operator.trim(),
        claimedAt: now,
        id: newId('stp'),
      };

      const created = await db.transaction('rw', db.steps, db.tests, async () => {
        const siblings = await db.steps.where('clockId').equals(record.clockId).toArray();
        const used = siblings.map((s) => s.seq);
        const maxSeq = used.length === 0 ? 0 : Math.max(...used);
        const suggested = maxSeq + 1;
        if (used.includes(record.seq)) {
          throw new SeqConflictError('occupied', record.seq, suggested);
        }
        if (record.seq > suggested) {
          throw new SeqConflictError('gap', record.seq, suggested);
        }
        await db.steps.put(record);
        // 工序结构变化（新增工序）：既有走时测试一并作废，需要复测
        await voidTestsInTx(db.tests, record.clockId, `新增工序 #${record.seq} ${record.stepType}`);
        return record;
      });

      this.items = [...this.items, created];
      await this.reloadTestsForClock(created.clockId);
      broadcastChange('steps', 'add');
      return created;
    },

    async finish(id: string) {
      const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
      const updated = await this.mutateStep(id, patch, (s) => `工序 #${s.seq} 完成`);
      return updated;
    },

    async rollback(id: string) {
      const patch: Partial<RepairStep> = { state: 'rolledback', finishedAt: undefined };
      const updated = await this.mutateStep(id, patch, (s) => `工序 #${s.seq} 回退`);
      return updated;
    },

    /** 完成 / 回退的公共事务：改工序 + 同事务作废走时测试 */
    async mutateStep(
      id: string,
      patch: Partial<RepairStep>,
      reason: (step: RepairStep) => string,
    ): Promise<RepairStep> {
      const updated = await db.transaction('rw', db.steps, db.tests, async () => {
        const step = await db.steps.get(id);
        if (!step) throw new Error('工序不存在或已被删除');
        const next: RepairStep = { ...step, ...toPlain(patch) };
        await db.steps.put(next);
        await voidTestsInTx(db.tests, step.clockId, reason(step));
        return next;
      });
      this.items = this.items.map((it) => (it.id === id ? updated : it));
      await this.reloadTestsForClock(updated.clockId);
      broadcastChange('steps', 'mutate');
      return updated;
    },

    /** 上下移动 / 拖拽排序：在一个事务内交换两个步骤的 seq，旧走时测试作废 */
    async swapSeq(aId: string, bId: string) {
      const result = await db.transaction('rw', db.steps, db.tests, async () => {
        const a = await db.steps.get(aId);
        const b = await db.steps.get(bId);
        if (!a || !b || a.clockId !== b.clockId) return null;
        const aNext: RepairStep = { ...a, seq: b.seq };
        const bNext: RepairStep = { ...b, seq: a.seq };
        await db.steps.put(aNext);
        await db.steps.put(bNext);
        await voidTestsInTx(db.tests, a.clockId, `工序 #${a.seq} 与 #${b.seq} 调整顺序`);
        return { aNext, bNext, clockId: a.clockId };
      });
      if (!result) return;
      this.items = this.items.map((it) => {
        if (it.id === aId) return result.aNext;
        if (it.id === bId) return result.bNext;
        return it;
      });
      await this.reloadTestsForClock(result.clockId);
      broadcastChange('steps', 'swap');
    },

    /** 从事务后的库里重载某台钟表的走时测试，保证作废位/原因/时间与磁盘一致 */
    async reloadTestsForClock(clockId: string) {
      const fresh = await db.tests.where('clockId').equals(clockId).toArray();
      fresh.sort((a, b) => b.testedAt - a.testedAt);
      this.tests = [...this.tests.filter((t) => t.clockId !== clockId), ...fresh].sort(
        (a, b) => b.testedAt - a.testedAt,
      );
    },

    async addTest(draft: TimekeepingTestDraft) {
      const record: TimekeepingTest = {
        ...toPlain(draft),
        id: newId('tst'),
        voided: false,
      };
      await db.tests.put(toPlain(record));
      this.tests = [record, ...this.tests];
      broadcastChange('tests', 'add-test');
      return record;
    },

    async removeTest(id: string) {
      await db.tests.delete(id);
      this.tests = this.tests.filter((it) => it.id !== id);
      broadcastChange('tests', 'remove-test');
    },
  },
});
