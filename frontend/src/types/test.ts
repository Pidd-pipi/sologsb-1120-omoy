/** 测试方位 */
export type TestPosition = '面上' | '面下' | '12上' | '6上';

export const TEST_POSITIONS: TestPosition[] = ['面上', '面下', '12上', '6上'];

/** 单方位读数 */
export interface PositionReading {
  position: TestPosition;
  /** 日差 s/d */
  rate: number;
  /** 摆幅 ° */
  amplitude: number;
  /** 偏振 ms */
  beatError: number;
}

/** 测试记录状态：工序一改动，既有有效测试即作废（stale）待复测 */
export type TestState = 'valid' | 'stale';

/** 走时测试记录 */
export interface TimekeepingTest {
  id: string;
  clockId: string;
  testedAt: number;
  /** 摆幅 ° */
  amplitude: number;
  /** 偏振 ms */
  beatError: number;
  /** 日差 s/d */
  rate: number;
  positions: PositionReading[];
  /** 动力储备 h */
  powerReserve: number;
  conclusion: string;
  /** valid=有效；stale=已作废（工序变更后需复测） */
  state: TestState;
  /** 作废时间 */
  invalidatedAt?: number;
  /** 触发作废的工序 id */
  invalidatedByStep?: string;
}

/** 新建草稿：state 由 store 落库为 valid */
export type TimekeepingTestDraft = Omit<TimekeepingTest, 'id' | 'state' | 'invalidatedAt' | 'invalidatedByStep'>;

/** 走时合格判定 */
export function judgeTest(rate: number, beatError: number, amplitude: number): string {
  if (Math.abs(rate) <= 10 && beatError <= 0.8 && amplitude >= 250) return '合格';
  if (Math.abs(rate) <= 30 && beatError <= 1.2) return '可用（需再调）';
  return '不合格';
}
