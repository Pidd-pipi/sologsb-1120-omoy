# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21820**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1120/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{clock,part,step,test,handover}.ts
        ├── stores/{clock,part,step,handoverStore}.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge,HandoverRecovery}.vue
        ├── hooks/{useClockSearch,useRepairProgress,useRepairer,useRemoteSync}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TestView}.vue
        └── utils/{db,timeCalc,id,sync}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏 | Clock |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流与走时测试记录，可切零件清单 | Clock、RepairStep、TimekeepingTest、MovementPart |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本 | TimekeepingTest |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 五张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序，新增 `claimOwner` 索引）、`tests`（走时测试，新增 `voided` 索引）、`handovers`（工序交接意图箱）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：旧工序还没有认领人的，按原责任人 `operator` 补回 `claimOwner`（不改 `startedAt`、不伪造 `claimedAt`）；旧走时测试补 `voided=false`；建立 `handovers` 表。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、3 项零件、3 道工序与 1 次走时测试。

## 功能要点

- **互斥工序交接**：两道修复台即同源两个标签页，共享同一 IndexedDB。认领在单个 `rw` 事务内「读 `claimOwner` → 判空 → 写」，浏览器对同源写事务串行化，构成比较并交换（CAS）：同一工序只会被一人接走，晚到方收到明确冲突并看到接走人；认领只写 `claimOwner/claimedAt`，**开始时间 `startedAt` 始终不动**。
- **交接意图箱（失败恢复）**：认领前先以独立事务往 `handovers` 写一条 `pending` 意图，再执行业务认领。业务写入若中断（掉电、标签页被杀），意图保留，重开应用自动恢复，也可用顶部横幅「一键恢复 / 重试」；已被他人接走的置 `failed` 终态，同一人重复提交幂等成功。
- **工序改动 → 走时作废联动**：新增工序、认领、完成、回退、调整顺序，都在与工序写入**同一事务**内把该钟仍有效的走时测试置 `voided`（带 `voidedAt/voidReason`）。台账分栏随之从「已完成」掉回「待测试」，钟表详情与走时单页标「已作废 · 待复测」；复测录入后重新计入有效。
- **跨台实时同步**：`BroadcastChannel` 通知其他标签页重载数据，一方认领或改动后另一界面立刻刷新；不支持时在页面重新可见时兜底刷新。
- **顺序号不跳号**：新建工序时顺序号占用/跳号校验下沉到写库事务内（`SeqConflictError`），并发下也不会被后写覆盖；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本（复测单会标注前次作废原因），可复制或下载 txt。
