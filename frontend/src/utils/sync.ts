/**
 * 跨标签页变更广播：一台修复台写入后，另一台实时刷新，
 * 不用等自己保存失败才能看到工序被谁接走。
 */
const CHANNEL_NAME = 'gbclockrepair:sync';

let channel: BroadcastChannel | null = null;
try {
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
} catch {
  channel = null;
}

export function notifyChanged(): void {
  try {
    channel?.postMessage({ type: 'changed', at: Date.now() });
  } catch {
    /* 广播失败不影响本地写入 */
  }
}

/** 注册监听；BroadcastChannel 不回发给发送者自身，无需去重 */
export function onChanged(handler: () => void): void {
  if (!channel) return;
  channel.onmessage = (ev: MessageEvent) => {
    if ((ev.data as { type?: string } | null)?.type === 'changed') handler();
  };
}
