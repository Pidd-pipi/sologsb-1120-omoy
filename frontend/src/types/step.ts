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
  operator: string;
  /** 开始时间：交接认领不改变该值 */
  startedAt: number;
  finishedAt?: number;
  state: StepState;
  /** 当前认领人：同一时刻只归一人，交接即换持有人 */
  claimedBy: string;
  /** 认领时间 */
  claimedAt: number;
  /** 交接版本号：每次交接 +1，认领时据此做乐观并发校验 */
  handoverVersion: number;
}

/** 新建草稿：认领字段由 store 在创建时落库（创建人即认领人） */
export type RepairStepDraft = Omit<RepairStep, 'id' | 'claimedBy' | 'claimedAt' | 'handoverVersion'>;
