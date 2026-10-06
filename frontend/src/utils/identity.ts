const ME_KEY = 'gbclockrepair:me';

/** 当前修复台的默认认领人：两台修复台各设各的，本机记住 */
export function getMe(): string {
  try {
    return window.localStorage.getItem(ME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setMe(name: string): void {
  try {
    window.localStorage.setItem(ME_KEY, name);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
