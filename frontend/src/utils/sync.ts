/**
 * 跨修复台（同源多标签页）数据变更广播。
 *
 * 两台修复台各自打开一份钟表档案时其实是两个标签页，共享同一个 IndexedDB。
 * 一方完成认领 / 工序改动后通知其他标签页重新拉取数据，
 * 晚到的一方因此能立刻看到「已被谁接走」。
 */

export type SyncScope = 'steps' | 'tests' | 'clocks' | 'parts' | 'handovers';

interface SyncMessage {
  scope: SyncScope | 'all';
  /** 触发动作，仅用于排查 */
  reason: string;
  at: number;
}

const CHANNEL_NAME = 'gbclockrepair:sync';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** 广播数据已变更，其他标签页收到后应重新加载对应 store */
export function broadcastChange(scope: SyncScope | 'all', reason: string): void {
  const ch = getChannel();
  if (!ch) return;
  const message: SyncMessage = { scope, reason, at: Date.now() };
  try {
    ch.postMessage(message);
  } catch {
    /* 通道关闭等异常忽略，接收方下次聚焦时仍可兜底刷新 */
  }
}

/** 订阅其他修复台的数据变更通知；返回退订函数 */
export function onRemoteChange(handler: (scope: SyncScope | 'all', reason: string) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (event: MessageEvent<SyncMessage>) => {
    handler(event.data.scope, event.data.reason);
  };
  ch.addEventListener('message', listener);

  // 兼容不支持 BroadcastChannel 的环境：标签页重新可见时兜底刷新
  const onVisible = () => {
    if (document.visibilityState === 'visible') handler('all', 'visible-refresh');
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    ch.removeEventListener('message', listener);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
