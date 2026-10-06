<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { readDbVersion } from './utils/db';
import { useRepairer } from './hooks/useRepairer';
import { useRemoteSync } from './hooks/useRemoteSync';
import { useHandoverStore } from './stores/handoverStore';
import HandoverRecovery from './components/common/HandoverRecovery.vue';

const route = useRoute();
const router = useRouter();
const { repairer, setRepairer } = useRepairer();
const handoverStore = useHandoverStore();

useRemoteSync();

const activeMenu = computed(() => {
  if (route.path.startsWith('/clocks')) return '/clocks';
  if (route.path.startsWith('/steps')) return '/steps/new';
  if (route.path.startsWith('/parts')) return '/parts';
  if (route.path.startsWith('/tests')) return '/tests';
  return '/clocks';
});

const version = readDbVersion();

function onSelect(index: string) {
  if (index === '/tests') {
    void router.push('/tests/');
    return;
  }
  void router.push(index);
}

onMounted(async () => {
  await handoverStore.load();
  // 上次认领写入失败后重开：自动尝试恢复这些交接
  await handoverStore.recoverAllPending();
});
</script>

<template>
  <el-container class="app">
    <el-header class="app-header">
      <div class="brand">古钟表维修工序档案</div>
      <el-menu :default-active="activeMenu" mode="horizontal" class="menu" @select="onSelect">
        <el-menu-item index="/clocks">钟表台账</el-menu-item>
        <el-menu-item index="/steps/new">工序录入</el-menu-item>
        <el-menu-item index="/parts">零件清单</el-menu-item>
        <el-menu-item index="/tests">走时测试</el-menu-item>
      </el-menu>
      <div class="repairer">
        <span class="repairer-label">当前修复师</span>
        <el-input
          :model-value="repairer"
          size="small"
          placeholder="姓名"
          clearable
          style="width: 120px"
          @update:model-value="setRepairer"
        />
      </div>
      <el-tag size="small" effect="plain">本地结构版本 v{{ version }}</el-tag>
    </el-header>
    <el-main class="app-main">
      <HandoverRecovery />
      <router-view />
    </el-main>
  </el-container>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #f6f8fa;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 18px;
  background: #2f3a46;
  color: #f4f6f8;
  height: 60px;
}
.brand {
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}
.menu {
  flex: 1;
  border-bottom: none;
  background: transparent;
}
:deep(.menu .el-menu-item) {
  color: #d6dde5;
}
:deep(.menu .el-menu-item.is-active) {
  color: #ffffff;
  border-bottom-color: #e7c56b;
}
.repairer {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.repairer-label {
  font-size: 13px;
  color: #c6ced8;
}
.app-main {
  padding: 18px 22px 40px;
}
</style>
