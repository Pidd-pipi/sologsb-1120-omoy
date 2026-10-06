/** 维修步骤类型 */
export type StepType = '拆解' | '清洗' | '润滑' | '装配' | '调试' | '走时测试';

export const STEP_TYPES: StepType[] = ['拆解', '清洗', '润滑', '装配', '调试', '走时测试'];

/** 步骤状态 */
export type StepState = 'pending' | 'done' | 'rolledback';

/** 各步骤类型的动态字段开关 */
export const STEP_FIELD_MAP: Record<
  StepType,
  { needSolvent: boolean; needOil: boolean; needTorque: boolean }
> = {
  拆解: { needSolvent: false, needOil: false, needTorque: true },
  清洗: { needSolvent: true, needOil: false, needTorque: false },
  润滑: { needSolvent: false, needOil: true, needTorque: false },
  装配: { needSolvent: false, needOil: true, needTorque: true },
  调试: { needSolvent: false, needOil: false, needTorque: false },
  走时测试: { needSolvent: false, needOil: false, needTorque: false },
};

/** 维修工序 */
export interface RepairStep {
  id: string;
  clockId: string;
  stepType: StepType;
  /** 顺序号，不得跳号 */
  seq: number;
  /** 关联零件 */
  partIds: string[];
  /** 清洗液 */
  cleanSolvent: string;
  /** 清洗方式 */
  cleanMethod: string;
  /** 润滑油脂型号 */
  oilType: string;
  /** 润滑点位 */
  oilPoints: string;
  /** 拧紧力矩 N·m */
  torque: number;
  troubleNote: string;
  /** 派工责任人（建档时填写） */
  operator: string;
  /** 实际认领接单人；空串表示尚未被认领，交接时原子写入，互斥唯一 */
  claimOwner: string;
  /** 认领时间（交接发生时刻）；与 startedAt 无关 */
  claimedAt?: number;
  startedAt: number;
  finishedAt?: number;
  state: StepState;
}

export type RepairStepDraft = Omit<RepairStep, 'id'>;

/** 顺序号冲突：被并发占用或发生跳号 */
export class SeqConflictError extends Error {
  kind: 'occupied' | 'gap';
  seq: number;
  suggested: number;
  constructor(kind: 'occupied' | 'gap', seq: number, suggested: number) {
    super(kind === 'occupied' ? `顺序号 ${seq} 已被占用` : `顺序号 ${seq} 跳号`);
    this.name = 'SeqConflictError';
    this.kind = kind;
    this.seq = seq;
    this.suggested = suggested;
  }
}

/** 工序已被他人认领：互斥交接的晚到方收到此错误，并能看到被谁接走 */
export class StepAlreadyClaimedError extends Error {
  /** 已接走该工序的责任人 */
  owner: string;
  claimedAt: number;
  constructor(owner: string, claimedAt: number) {
    super(`工序已被 ${owner} 接走`);
    this.name = 'StepAlreadyClaimedError';
    this.owner = owner;
    this.claimedAt = claimedAt;
  }
}
