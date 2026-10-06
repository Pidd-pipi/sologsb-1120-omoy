import { onMounted, onUnmounted } from 'vue';
import { onRemoteChange } from '../utils/sync';
import { useStepStore } from '../stores/stepStore';
import { useHandoverStore } from '../stores/handoverStore';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';

/**
 * 订阅其他修复台（标签页）的数据变更，收到通知后重载对应 store，
 * 保证晚到一方的界面能立刻反映「工序已被谁接走、走时测试已作废」。
 */
export function useRemoteSync() {
  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    unsubscribe = onRemoteChange(async (scope) => {
      const stepStore = useStepStore();
      const handoverStore = useHandoverStore();
      const clockStore = useClockStore();
      const partStore = usePartStore();

      if (scope === 'all' || scope === 'steps' || scope === 'tests') {
        if (stepStore.loaded) await stepStore.load();
      }
      if (scope === 'all' || scope === 'handovers') {
        if (handoverStore.loaded) await handoverStore.load();
      }
      if (scope === 'all' || scope === 'clocks') {
        if (clockStore.loaded) await clockStore.load();
      }
      if (scope === 'all' || scope === 'parts') {
        if (partStore.loaded) await partStore.load();
      }
    });
  });

  onUnmounted(() => unsubscribe?.());
}
