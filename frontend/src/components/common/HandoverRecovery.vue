<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { ElMessage } from 'element-plus';
import { useHandoverStore } from '../../stores/handoverStore';
import { useStepStore } from '../../stores/stepStore';

const handoverStore = useHandoverStore();
const stepStore = useStepStore();
const { pending } = storeToRefs(handoverStore);

const busyId = ref('');

function stepLabel(h: (typeof pending.value)[number]) {
  const step = stepStore.byId(h.stepId);
  return `#${h.seq}${h.stepType ? ` ${h.stepType}` : ''}${step ? '' : '（工序可能已删除）'}`;
}

async function recoverAll() {
  for (const h of pending.value) {
    busyId.value = h.id;
    const result = await handoverStore.recover(h.id);
    if (result.ok) {
      ElMessage.success(`已恢复交接：${stepLabel(h)} 由 ${h.owner} 接走`);
    } else if (result.conflict) {
      ElMessage.warning(`${stepLabel(h)} 已被 ${result.owner} 接走`);
    } else {
      ElMessage.error(`${stepLabel(h)} 恢复失败：${result.error}，可再次重试`);
      break;
    }
  }
  busyId.value = '';
}

async function recoverOne(id: string) {
  busyId.value = id;
  try {
    const h = handoverStore.items.find((it) => it.id === id);
    const result = await handoverStore.recover(id);
    if (result.ok) {
      ElMessage.success(`已恢复交接：${h ? stepLabel(h) : '工序'} 由 ${result.owner} 接走`);
    } else if (result.conflict) {
      ElMessage.warning(`工序已被 ${result.owner} 接走`);
    } else {
      ElMessage.error(`恢复失败：${result.error}，可再次重试`);
    }
  } finally {
    busyId.value = '';
  }
}

const hasPending = computed(() => pending.value.length > 0);
</script>

<template>
  <el-alert
    v-if="hasPending"
    type="warning"
    show-icon
    :closable="false"
    class="recovery-banner"
    data-testid="handover-recovery"
  >
    <template #title>
      <div class="banner-line">
        <span>
          有 {{ pending.length }} 次工序交接未完成（上次写入失败中断），可恢复本次交接：
        </span>
        <el-button size="small" type="warning" :loading="!!busyId" @click="recoverAll">
          一键恢复
        </el-button>
      </div>
    </template>
    <div v-for="h in pending" :key="h.id" class="banner-item">
      <el-tag size="small" :type="h.status === 'failed' ? 'danger' : 'warning'">
        {{ h.status === 'failed' ? '被接走' : '待恢复' }}
      </el-tag>
      <span>{{ stepLabel(h) }}</span>
      <span class="muted">拟认领：{{ h.owner }}</span>
      <span v-if="h.lastError" class="err">{{ h.lastError }}</span>
      <el-button
        v-if="h.status !== 'failed'"
        size="small"
        :loading="busyId === h.id"
        @click="recoverOne(h.id)"
      >
        重试交接
      </el-button>
      <el-button size="small" text @click="handoverStore.dismiss(h.id)">忽略</el-button>
    </div>
  </el-alert>
</template>

<style scoped>
.recovery-banner {
  margin-bottom: 12px;
}
.banner-line {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.banner-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 13px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
}
.err {
  color: #c45656;
}
</style>
