import { ref } from 'vue';

const REPAIRER_KEY = 'gbclockrepair:repairer';

function readInitial(): string {
  try {
    return window.localStorage.getItem(REPAIRER_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 当前坐在修复台前的修复师姓名（全局单例，跨页面共享并持久化） */
const repairer = ref<string>(readInitial());

export function useRepairer() {
  function setRepairer(name: string) {
    const value = name.trim();
    repairer.value = value;
    try {
      if (value) window.localStorage.setItem(REPAIRER_KEY, value);
      else window.localStorage.removeItem(REPAIRER_KEY);
    } catch {
      /* localStorage 不可用时仅保留内存值 */
    }
  }

  return { repairer, setRepairer };
}
