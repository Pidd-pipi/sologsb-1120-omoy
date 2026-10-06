<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import { judgeTest } from '../types/test';
import type { RepairStep } from '../types/step';
import { HandoverConflictError } from '../utils/handover';
import { getMe, setMe } from '../utils/identity';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
const activeTab = ref('steps');

const claimTarget = ref<RepairStep | null>(null);
const claimName = ref('');
const claiming = ref(false);

function openClaim(row: RepairStep) {
  claimTarget.value = row;
  claimName.value = getMe() || row.claimedBy || row.operator;
}

async function doClaim() {
  const target = claimTarget.value;
  if (!target) return;
  const name = claimName.value.trim();
  if (!name) {
    ElMessage.warning('请填写认领人');
    return;
  }
  claiming.value = true;
  try {
    const updated = await stepStore.claim(target.id, name);
    setMe(name);
    claimTarget.value = null;
    ElMessage.success(
      `工序 #${updated.seq} 已由「${name}」认领，开始时间保持 ${new Date(updated.startedAt).toLocaleString('zh-CN')}`,
    );
  } catch (err) {
    if (err instanceof HandoverConflictError) {
      const when = err.holderClaimedAt ? new Date(err.holderClaimedAt).toLocaleString('zh-CN') : '—';
      await ElMessageBox.alert(
        `该工序已于 ${when} 被「${err.holder || '他人'}」接走，本次认领未生效。列表已刷新为最新归属。`,
        '认领冲突',
        { type: 'warning', confirmButtonText: '知道了' },
      );
      claimTarget.value = null;
    } else {
      ElMessage.error(
        `认领写入失败：${err instanceof Error ? err.message : String(err)}。可到台账页点「恢复交接」重试，本次交接不会丢。`,
      );
    }
  } finally {
    claiming.value = false;
  }
}

async function finish(id: string) {
  await stepStore.finish(id);
  ElMessage.success('步骤已完成，既有走时测试已作废待复测');
}
async function rollback(id: string) {
  await stepStore.rollback(id);
  ElMessage.warning('步骤已回退，既有走时测试已作废待复测');
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  await stepStore.swapSeq(payload.id, target.id);
  ElMessage.success('顺序已调整');
}
async function reorder(payload: { fromId: string; toId: string }) {
  await stepStore.swapSeq(payload.fromId, payload.toId);
  ElMessage.success('已按拖拽交换顺序');
}
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/steps/new?clockId=${clockId}`)">追加维修工序</el-button>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />

    <div v-if="clock" class="grid">
      <el-card shadow="never">
        <template #header><strong>机芯信息</strong></template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="藏品号">{{ clock.clockNo }}</el-descriptions-item>
          <el-descriptions-item label="种类">{{ clock.kind }}</el-descriptions-item>
          <el-descriptions-item label="机芯型号">{{ clock.caliber }}</el-descriptions-item>
          <el-descriptions-item label="国别 / 制作者">{{ clock.origin }} / {{ clock.maker }}</el-descriptions-item>
          <el-descriptions-item label="年代">{{ clock.yearMade }}</el-descriptions-item>
          <el-descriptions-item label="钟壳材质">{{ clock.caseMaterial }}</el-descriptions-item>
          <el-descriptions-item label="尺寸 mm">{{ clock.size }}</el-descriptions-item>
          <el-descriptions-item label="盘面标识">{{ clock.dialMark }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ clock.acquireFrom }}</el-descriptions-item>
          <el-descriptions-item label="存放位置">{{ clock.storagePos }}</el-descriptions-item>
          <el-descriptions-item label="零件条目">{{ parts.length }} 项</el-descriptions-item>
        </el-descriptions>
        <div class="grade-row">
          <span>品相等级：</span>
          <el-radio-group :model-value="clock.conditionGrade" size="small" @change="changeGrade">
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
        </div>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（认领人 {{ current.claimedBy || '未认领' }}）
              </span>
              <span v-else class="muted">全部步骤已完成</span>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                sortable
                @finish="finish"
                @rollback="rollback"
                @claim="openClaim"
                @move="move"
                @reorder="reorder"
              />
            </el-tab-pane>
            <el-tab-pane :label="`零件清单（${parts.length}）`" name="parts">
              <el-table :data="parts" size="small" border>
                <el-table-column prop="name" label="零件" width="110" />
                <el-table-column prop="position" label="装配位置" min-width="150" />
                <el-table-column prop="wearState" label="磨损" width="90" />
                <el-table-column prop="decision" label="处理" width="90" />
                <el-table-column prop="sourceLot" label="来源批号" width="120" />
                <el-table-column prop="dimension" label="尺寸 mm" width="100" />
              </el-table>
              <el-empty v-if="parts.length === 0" description="暂无零件登记" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`走时测试（${tests.length}）`" name="tests">
              <div v-for="t in tests" :key="t.id" class="test-block" :class="{ stale: t.state === 'stale' }">
                <div class="card-head">
                  <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                  <el-tag size="small" type="success">{{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}</el-tag>
                  <el-tag v-if="t.state === 'stale'" size="small" type="danger">已作废·需复测</el-tag>
                  <el-tag v-else size="small" type="success" effect="plain">有效</el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                </div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <el-dialog :model-value="!!claimTarget" title="认领工序" width="460px" @close="claimTarget = null">
      <template v-if="claimTarget">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 14px">
          <el-descriptions-item label="工序">#{{ claimTarget.seq }} {{ claimTarget.stepType }}</el-descriptions-item>
          <el-descriptions-item label="当前持有人">{{ claimTarget.claimedBy || '未认领' }}</el-descriptions-item>
          <el-descriptions-item label="开始时间">
            {{ new Date(claimTarget.startedAt).toLocaleString('zh-CN') }}（交接不改变开始时间）
          </el-descriptions-item>
        </el-descriptions>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="同一时刻只有一人能认领成功；若他人刚接走，将提示实际持有人。"
          style="margin-bottom: 14px"
        />
        <el-form label-width="80px">
          <el-form-item label="认领人" required>
            <el-input v-model="claimName" placeholder="填写认领人姓名" @keyup.enter="doClaim" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="claimTarget = null">取消</el-button>
        <el-button type="primary" :loading="claiming" @click="doClaim">确认认领</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.grade-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.test-block {
  margin-bottom: 16px;
}
.test-block.stale {
  opacity: 0.55;
}
</style>
