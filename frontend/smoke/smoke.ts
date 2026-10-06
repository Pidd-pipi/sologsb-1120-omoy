/* eslint-disable no-console */
/**
 * 冒烟验证（不依赖浏览器）：node + fake-indexeddb 跑真实 Dexie 事务与迁移。
 * 覆盖：v2→v3 迁移补回认领人 / 认领互斥 / 冲突可见 / startedAt 不动 /
 *       工序改动作废测试 / 失败交接恢复 / 并发顺序号冲突。
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { setActivePinia, createPinia } from 'pinia';

const T0 = 1_700_000_000_000;
let passed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name} ${extra}`);
    process.exitCode = 1;
  }
}

// —— 1. 先用 v2 结构造「旧档案」（工序无 claimedBy、测试无 state）——
const legacy = new Dexie('gbclockrepair');
legacy.version(1).stores({
  clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
  parts: 'id, clockId, name, wearState, decision',
  steps: 'id, clockId, seq, stepType, state',
  tests: 'id, clockId, testedAt',
});
legacy.version(2).stores({
  clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
  parts: 'id, clockId, name, wearState, decision, sourceLot',
  steps: 'id, clockId, seq, stepType, state, startedAt',
  tests: 'id, clockId, testedAt, conclusion',
});
await legacy.open();
await legacy.table('clocks').put({ id: 'clk1', clockNo: 'CLK-OLD-001', createdAt: T0 });
await legacy.table('steps').put({
  id: 'stp1', clockId: 'clk1', stepType: '清洗', seq: 1, partIds: [],
  cleanSolvent: '', cleanMethod: '', oilType: '', oilPoints: '', torque: 0,
  troubleNote: '', operator: '祁仲言', startedAt: T0, state: 'pending',
});
await legacy.table('tests').put({
  id: 'tst1', clockId: 'clk1', testedAt: T0 + 1000, amplitude: 260, beatError: 0.4,
  rate: 5, positions: [], powerReserve: 42, conclusion: '合格',
});
await legacy.close();

// —— 2. 打开真实 v3 库（触发真实迁移代码）——
const { db } = await import('../src/utils/db.ts');
const { claimStep, recoverPendingHandovers, HandoverConflictError } = await import('../src/utils/handover.ts');
const { useStepStore } = await import('../src/stores/stepStore.ts');

console.log('迁移 v2 → v3：');
const migrated = await db.steps.get('stp1');
check('旧工序按原责任人补回认领人', migrated?.claimedBy === '祁仲言');
check('认领时间取开始时间', migrated?.claimedAt === T0);
check('交接版本号补 1', migrated?.handoverVersion === 1);
const migratedTest = await db.tests.get('tst1');
check('旧测试记为有效', (migratedTest as any)?.state === 'valid');

// —— 3. 两台修复台同时认领同一工序 ——
console.log('并发认领：');
const results = await Promise.allSettled([
  claimStep({ stepId: 'stp1', operator: '修复台A-小周', expectedVersion: 1 }),
  claimStep({ stepId: 'stp1', operator: '修复台B-小吴', expectedVersion: 1 }),
]);
const ok = results.filter((r) => r.status === 'fulfilled');
const conflicted = results.filter(
  (r): r is PromiseRejectedResult => r.status === 'rejected' && r.reason instanceof HandoverConflictError,
);
check('只有一个人认领成功', ok.length === 1 && conflicted.length === 1, JSON.stringify(results.map((r) => r.status)));
const winner = (ok[0] as PromiseFulfilledResult<any>).value;
const loserErr = conflicted[0]?.reason as InstanceType<typeof HandoverConflictError>;
check('晚到的一边看到被谁接走', loserErr?.holder === winner.claimedBy, `holder=${loserErr?.holder}`);
check('开始时间不动', winner.startedAt === T0, `startedAt=${winner.startedAt}`);
check('交接版本号推进到 2', winner.handoverVersion === 2);
const stepAfter = await db.steps.get('stp1');
check('库内归属唯一且为赢家', stepAfter?.claimedBy === winner.claimedBy);
const testAfter = await db.tests.get('tst1');
check('工序交接后走时测试作废', (testAfter as any)?.state === 'stale' && !!(testAfter as any)?.invalidatedAt);
const rejectedLog = await db.handovers.where('status').equals('rejected').toArray();
check('冲突交接日志记为 rejected 并带持有人', rejectedLog.length === 1 && rejectedLog[0].holder === winner.claimedBy);

// —— 4. 同一人重复认领（恢复重放场景）幂等 ——
console.log('幂等重放：');
const again = await claimStep({ stepId: 'stp1', operator: winner.claimedBy, expectedVersion: 1 });
check('过期版本重放不报错（幂等了结）', again.claimedBy === winner.claimedBy);

// —— 5. 写入失败的交接可恢复 ——
console.log('失败恢复：');
await db.tests.put({
  id: 'tst2', clockId: 'clk1', testedAt: Date.now(), amplitude: 258, beatError: 0.5,
  rate: 8, positions: [], powerReserve: 40, conclusion: '合格', state: 'valid',
} as any);
// 模拟：日志已落 pending，但认领事务没跑成（崩溃/失败）
await db.handovers.put({
  id: 'hov-crashed', stepId: 'stp1', clockId: 'clk1',
  fromOperator: winner.claimedBy, toOperator: '修复台B-小吴',
  expectedVersion: (await db.steps.get('stp1'))!.handoverVersion,
  status: 'pending', createdAt: Date.now(),
});
const rec = await recoverPendingHandovers();
check('恢复重放成功 1 条', rec.recovered === 1 && rec.failed === 0, JSON.stringify(rec));
const recovered = await db.steps.get('stp1');
check('交接补写完成（换到小吴）', recovered?.claimedBy === '修复台B-小吴');
check('恢复后开始时间仍不动', recovered?.startedAt === T0);
const tst2 = await db.tests.get('tst2');
check('恢复交接同样作废旧测试', (tst2 as any)?.state === 'stale');
check('交接日志闭环为 applied', (await db.handovers.get('hov-crashed'))?.status === 'applied');

// —— 6. store 层：并发新建同顺序号 + 完成作废 ——
console.log('store 并发顺序号 / 完成作废：');
setActivePinia(createPinia());
const store = useStepStore();
await store.load();
const draft = {
  clockId: 'clk1', stepType: '润滑' as const, seq: 2, partIds: [],
  cleanSolvent: '', cleanMethod: '', oilType: '', oilPoints: '', torque: 0,
  troubleNote: '', operator: '修复台A-小周', startedAt: Date.now(), state: 'pending' as const,
};
const adds = await Promise.allSettled([store.add({ ...draft }), store.add({ ...draft })]);
const addOk = adds.filter((r) => r.status === 'fulfilled');
const addErr = adds.filter((r) => r.status === 'rejected');
check('同顺序号并发保存只成功一条', addOk.length === 1 && addErr.length === 1);
check(
  '后到的一边收到顺序号冲突',
  addErr.length === 1 && String((addErr[0] as PromiseRejectedResult).reason).includes('已被占用'),
  String((addErr[0] as PromiseRejectedResult)?.reason),
);
const seq2 = (addOk[0] as PromiseFulfilledResult<any>).value;
check('新工序创建人即认领人', seq2.claimedBy === '修复台A-小周' && seq2.handoverVersion === 1);
await db.tests.put({
  id: 'tst3', clockId: 'clk1', testedAt: Date.now(), amplitude: 261, beatError: 0.3,
  rate: 4, positions: [], powerReserve: 44, conclusion: '合格', state: 'valid',
} as any);
await store.load();
await store.finish(seq2.id);
const tst3 = await db.tests.get('tst3');
check('工序完成即作废有效测试', (tst3 as any)?.state === 'stale');
check('台账有效测试只认 valid', store.validTestsByClock('clk1').length === 0);

console.log(passed > 0 && !process.exitCode ? `\n全部 ${passed} 项通过` : '\n存在失败项');
await db.delete();
