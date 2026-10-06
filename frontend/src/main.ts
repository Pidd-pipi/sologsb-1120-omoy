import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';
import { ensureSeedData, markDbVersion } from './utils/db';
import { recoverPendingHandovers } from './utils/handover';

async function bootstrap() {
  // 先完成 IndexedDB 迁移与示范数据灌入，再挂载应用，避免首屏空态抖动
  await ensureSeedData();
  // 恢复上次写库失败/中断的工序交接（重放交接日志），失败不阻塞启动
  try {
    await recoverPendingHandovers();
  } catch {
    /* 恢复失败留待台账页手动重试 */
  }
  markDbVersion();

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(ElementPlus, { locale: zhCn });
  app.mount('#app');
}

void bootstrap();
