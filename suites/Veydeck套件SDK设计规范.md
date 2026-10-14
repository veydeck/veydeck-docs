# Veydeck 套件 SDK 设计规范

## SDK 边界

Veydeck 套件包含两类相互隔离的 SDK：

- `@veydeck/suite-sdk` 是浏览器 iframe Bridge，只负责主题、语言、通知、导航和窗口交互。
- `veydeck-suite-runtime-sdk` 是套件后端 Runtime SDK，提供 Rust 与 Python 实现，负责读取 Agent 注入的实例描述、UDS/mTLS HTTPS、令牌认证和受控能力调用。

浏览器 SDK 不得读取 `/run/veydeck-agent/runtime.json`、实例令牌、客户端证书或私钥。后端 Runtime SDK 不参与 iframe 消息协议。

## 后端 Runtime SDK

### 安装与导入

Runtime SDK 通过 crates.io 和 PyPI 发布，包名均为 `veydeck-suite-runtime-sdk`，代码导入名均为 `veydeck_suite_runtime`。

Rust 项目在 `Cargo.toml` 中声明：

```toml
[dependencies]
veydeck-suite-runtime-sdk = "=0.1.0-alpha.1"
```

Python 项目安装：

```bash
pip install veydeck-suite-runtime-sdk==0.1.0a1
```

Python 包按 PEP 440 将 `0.1.0-alpha.1` 规范化为 `0.1.0a1`。前端 Bridge 通过 npm 安装 `@veydeck/suite-sdk@0.1.0-alpha.1`，Vue 与 React 组件分别使用 `@veydeck/vue`、`@veydeck/react` 的 `Vey*` 导出。

### 运行描述与连接

Agent 只向 `suite.yaml` 的 `runtime.agent.services` 中声明的服务注入 `VEYDECK_AGENT_RUNTIME`。未设置时 SDK 默认读取 `/run/veydeck-agent/runtime.json`。当前描述如下：

```json
{
  "schemaVersion": 1,
  "platformVersion": "0.1.0-alpha.4",
  "suiteId": "veydeck.protocol-simulation",
  "instanceId": "019c...",
  "endpoint": {
    "kind": "unix",
    "socketPath": "/run/veydeck-agent/agent.sock",
    "baseUrl": "http://localhost"
  },
  "credential": {
    "tokenPath": "/run/veydeck-agent/token"
  },
  "capabilities": ["workloads.manage", "captures.manage", "operation-logs.write"]
}
```

外部节点可使用 `kind: https`，并提供 `baseUrl`、CA、客户端证书和私钥路径。Rust 与 Python SDK 都必须：

1. 校验 `schemaVersion`、严格 SemVer 格式的 `platformVersion` 和实例身份。
2. 在构造客户端时要求业务所需 capability，缺少时立即失败。
3. 从 `tokenPath` 读取 Bearer token，不允许把 token 写入业务配置或日志。
4. 根据描述选择 UDS 或 mTLS HTTPS，不让业务代码自行拼装 Agent 地址。

`runtime.images` 是 Agent 保存的 workload 镜像白名单，不属于 Runtime 描述字段。规则包等扩展资产可使用 `platformVersion` 校验自身 `minVeydeckVersion`，但不得据此扩大 Agent 授权。

`suite.yaml.compatibility.platformContractVersion` 同样不写入 Runtime 描述。它由主控在套件导入、安装和平台升级兼容性检查中使用；Runtime SDK 不读取、推导或协商该字段。

### Workload 契约

Runtime SDK 的 Rust crate 与 Python package 暴露同构异步 API：

| SDK 方法 | Agent 路径 | 所需能力 |
| --- | --- | --- |
| `start_workload` | `POST /api/v1/agent/suite-runtime/workloads` | `workloads.manage` |
| `list_workloads` | `GET /api/v1/agent/suite-runtime/workloads` | `workloads.manage` |
| `delete_workload` | `DELETE /api/v1/agent/suite-runtime/workloads/{workload_id}` | `workloads.manage` |
| `start_capture` | `POST /api/v1/agent/suite-runtime/workloads/{workload_id}/captures` | `captures.manage` |
| `finish_capture` | `POST /api/v1/agent/suite-runtime/workloads/{workload_id}/captures/{capture_id}/finish` | `captures.manage` |

创建请求使用 `workloadKind`、`workloadName`、`image`、`ports`、`env`、`configJson` 和 `resources`。`workloadName` 由套件提供，必须是唯一、可读的完整名称主体；Agent 清洗该值并添加统一的 `sl-` 容器名前缀。每个 `ports` 元素包含稳定的 `endpointId`、`hostPort`、`containerPort` 与 `protocol`；`protocol` 当前只允许 `tcp` 或 `udp`。端点身份不能从端口号推导，同一数字端口可以分别用于 TCP 和 UDP。

SDK 只提交期望状态，Agent 负责校验镜像白名单、端口冲突、资源限制和实例归属。列表和删除只能看见或操作当前实例创建的 workload。

### 整 workload 抓包

`start_capture(workloadId)` 不接收端口参数。Agent 根据 workload 的实际已发布端点一次启动全部 TCP/UDP 捕获，并返回 `captureId`、状态和端点列表。`finish_capture(workloadId, captureId)` 返回原始 PCAP 字节：Rust 类型为 `Vec<u8>`，Python 类型为 `bytes`，不得使用 Base64 JSON 中转。

具体状态和清理规则见 [Veydeck 协议仿真 PCAP 取证设计规范](../simulation/Veydeck交互式PCAP流量取证设计规范.md)。

### 操作事件

`submit_operation_event` 需要 `operation-logs.write`。事件使用 UUIDv7 `eventId` 保证幂等，事件码使用稳定的 lower snake case，并携带中英文名称、结果、影响级别和可脱敏详情。SDK 对传输失败和可重试服务端错误执行有限重试；认证、授权和参数错误立即返回。

用户身份、客户端 IP、节点、套件和实例归属由 Agent 根据令牌及受信操作上下文恢复，套件输入不能覆盖。自主后台事件没有用户上下文时，才以套件实例作为操作者。

### 跨语言一致性

共享 `contracts/` 目录是 Rust 与 Python 的 wire contract 基准。公开 JSON 字段保持 `camelCase`，运行描述、workload、capture 和操作事件 fixture 必须在两种实现中通过同一组有效与无效样例。

## 定位

`@veydeck/suite-sdk` 是 Veydeck 主控与套件 Web 前端之间的标准通信层。

SDK 不绑定 Vue 或 React，不负责业务 API、容器生命周期、权限决策和主控路由生成。

## 分层

### Transport

负责 `postMessage` 消息收发和基础校验。

消息统一使用 envelope：

```ts
interface SuiteMessage<TPayload = unknown> {
  protocolVersion: 1;
  source: "veydeck-suite" | "veydeck-host";
  type: string;
  id?: string;
  requestId?: string;
  payload?: TPayload;
  error?: SuiteMessageError;
}
```

`id`、`requestId` 和 `error` 首期不强依赖，但保留给后续 RPC。

### Bridge

负责主控与套件的语义协议。

首期内置消息：

- `suite:lifecycle:ready`
- `host:theme:update`
- `host:locale:update`
- `suite:notification:show`
- `suite:navigation:open`
- `suite:window:focus`

蓝图占位消息：

- `host:context:update`
- `host:permission:grant`
- `host:permission:deny`
- `suite:dialog:confirm`
- `suite:window:title:update`
- `suite:window:dirty:update`
- `suite:file:open`
- `suite:file:save`
- `suite:log:event`
- `suite:error:report`
- `suite:lifecycle:heartbeat`
- `suite:lifecycle:status`

蓝图占位只定义命名和类型方向，不代表当前 SDK 已实现业务行为。

### Adapter

首期只提供无框架 TypeScript API。

后续可以按需增加：

- Vue composable
- React hook
- 套件模板初始化工具

## 源码结构

SDK 按职责拆分模块，源码统一放在 `src/` 目录下，避免和包配置文件混在同一层级。

- `src/index.ts`: 公开导出入口，不承载运行逻辑。
- `src/types.ts`: 公开类型定义。
- `src/protocol.ts`: 协议版本、消息类型常量、消息创建与校验。
- `src/environment.ts`: 浏览器环境和 iframe 解析辅助函数。
- `src/theme.ts`: 主题解析、系统主题降级和 DOM 主题写入。
- `src/locale.ts`: 浏览器语言降级、语言匹配和语言归一化。
- `src/suite-bridge.ts`: 套件端 Bridge。
- `src/host-bridge.ts`: 主控端 Bridge。

## 能力蓝图

### 1. 主题同步

主题状态：

```ts
interface SuiteThemeState {
  theme: "light" | "dark" | "auto";
  resolvedTheme: "light" | "dark";
  glassEnabled: boolean;
  source: "host" | "system";
}
```

套件端初始化后立即使用系统主题作为降级方案，并写入：

```ts
document.documentElement.dataset.theme = resolvedTheme;
document.documentElement.dataset.glass = glassEnabled ? "enabled" : "disabled";
document.documentElement.style.colorScheme = resolvedTheme;
```

主控发送主题后，套件以主控主题和材质偏好为准。独立运行、旧主控载荷缺少字段或收到无效值时，`glassEnabled` 默认使用 `true`。

当前已实现。

### 2. 国际化同步

国际化与主题同级，是体验一致性的基础能力。

当主控语言为中文时，套件不应仍显示英文；当主控切换英文时，套件也应同步切换。套件不应自行读取主控本地存储或 DOM，而是通过 SDK 接收标准语言状态。

蓝图状态：

```ts
interface SuiteLocaleState {
  locale: string;
  source: "host" | "browser" | "default";
}
```

协议消息：

- `host:locale:update`

套件端 API：

```ts
bridge.subscribeLocale((locale) => {
  i18n.global.locale.value = locale.locale;
});
```

独立运行降级：

- 优先使用 `navigator.language`。
- 套件不支持时使用默认语言。

当前 SDK 已实现 locale 状态维护、订阅和主控消息接收。套件业务是否接入 Vue I18n、React I18n 或其它国际化方案，由套件自行决定。

### 3. 主控上下文

主控上下文用于让套件知道自己运行在哪里，但不暴露主控内部实现。

上下文只传递套件运行需要的稳定信息，例如套件 ID、实例 ID、应用 ID、运行模式、代理基础路径、当前用户和节点摘要。套件不能依赖主控内部 store、路由对象或 DOM 结构。

蓝图 payload：

```ts
interface SuiteContextPayload {
  suiteId: string;
  instanceId?: string;
  appId?: string;
  runMode: "hosted" | "standalone";
  basePath?: string;
  user?: { id: string; name?: string };
  node?: { id: string; name?: string };
}
```

协议消息：

- `host:context:update`

当前只保留协议占位。

### 4. 能力声明

能力声明是未来权限控制和版本兼容的基础。

套件通过 `suite:lifecycle:ready` 声明自己支持的能力，主控未来也可以返回当前环境开放的能力。这样不同版本的主控和套件可以在运行时协商能力，而不是通过隐式约定硬编码。

蓝图能力：

```ts
type SuiteCapability =
  | "theme"
  | "locale"
  | "context"
  | "notification"
  | "dialog"
  | "navigation"
  | "window"
  | "file"
  | "diagnostics"
  | "heartbeat";
```

当前已用于套件 ready 消息，并已对 `theme`、`locale`、`notification`、`navigation` 和 `window` 提供 SDK 运行逻辑。

### 5. 通知能力

套件不应自行实现与主控割裂的 toast 或 notification。作为套件运行时，套件应优先请求主控展示统一通知，由主控负责样式、位置和生命周期；独立运行时再使用套件自己的本地通知。

协议消息：

- `suite:notification:show`

payload：

```ts
interface SuiteNotificationPayload {
  type?: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  duration?: number;
}
```

套件端调用：

```ts
const delivered = bridge.notify({
  type: "success",
  title: "扫描完成",
  message: "发现 12 台存活主机",
});

if (!delivered) {
  showLocalToast("success", "扫描完成", "发现 12 台存活主机");
}
```

设计约束：

- 套件必须声明 `notification` capability。
- `notify()` 返回 `true` 只表示消息已投递给主控，不表示用户一定看到了通知。
- 主控首期只展示弹窗，不写入通知历史，避免套件高频操作污染主控历史记录。
- 通知标题保留套件传入的业务标题，主控不自动拼接套件名称。

当前已实现。

### 6. 确认对话框

危险操作应由主控弹出统一确认框，例如删除报告、停止任务、清理数据。这样可以保证套件和主控交互一致，也方便未来接入权限、审计和二次确认策略。

协议消息：

- `suite:dialog:confirm`

蓝图调用：

```ts
const confirmed = await bridge.request("suite:dialog:confirm", {
  title: "删除报告",
  message: "删除后无法恢复，是否继续？",
  danger: true,
});
```

当前只保留协议占位。

### 7. 导航能力

套件需要打开主控中的其它应用、跳转套件中心、返回桌面或打开外链时，应通过主控导航能力完成，而不是直接假设主控路由结构。

协议消息：

- `suite:navigation:open`

当前支持目标：

- 打开内置应用。
- 打开套件中心。
- 返回桌面。
- 打开外链，并由主控决定是否需要安全提示。

套件端 API：

```ts
bridge.navigate({
  target: "suite-center",
});
```

`navigate()` 返回 `true` 只表示消息已投递给主控。主控是否允许打开目标，由主控窗口、权限和应用注册状态决定。

### 8. 窗口聚焦、标题与脏状态

套件应能告诉主控当前窗口正在被交互、当前页面标题和是否存在未保存变更。

窗口聚焦用于解决 iframe 内点击事件无法冒泡到主控窗口容器的问题。声明 `window` capability 后，套件端 SDK 会在 `pointerdown` 和 `focusin` 时自动发送聚焦消息；主控收到后把承载窗口置顶。未接入新版 SDK 的套件由主控透明聚焦层兜底。

窗口标题用于让应用窗口、任务栏或未来的窗口管理器展示更具体的上下文。脏状态用于拦截关闭窗口、刷新 iframe 或切换页面，避免用户丢失未保存内容。

协议消息：

- `suite:window:focus`
- `suite:window:title:update`
- `suite:window:dirty:update`

当前已实现 `suite:window:focus`，标题和脏状态仍只保留协议占位。

### 9. RPC 请求响应机制

这里的 RPC 不是 gRPC，而是基于 `postMessage` 的 request/response 模型。

当前 envelope 已保留：

- `id`: 请求消息 ID。
- `requestId`: 响应对应的请求 ID。
- `error`: 标准错误对象。

未来可以提供：

```ts
const result = await bridge.request("suite:notification:show", payload);
```

主控处理后返回同一协议 envelope。这样通知、确认对话框、文件选择、权限请求等能力都可以共享同一套调用模型。

当前只保留字段和设计方向，暂不实现 `request()`。

### 10. 权限模型

权限模型不应在第一版做复杂实现，但协议需要预留位置。

未来套件可能需要请求敏感能力，例如文件访问、主控导航、节点操作或长期任务。主控应能够根据套件来源、用户身份、部署策略和权限配置决定是否授权。

协议消息：

- `host:permission:grant`
- `host:permission:deny`

未来可扩展：

- `suite:permission:request`
- `host:permission:update`

当前只保留协议占位。

### 11. 文件选择与下载

很多套件会需要导入、导出或选择文件。由主控提供统一文件能力，可以让体验一致，并为未来的权限控制、审计和跨节点文件访问打基础。

协议消息：

- `suite:file:open`
- `suite:file:save`

蓝图场景：

- 选择本地规则文件。
- 导出扫描报告。
- 保存配置模板。
- 交给主控决定文件来源和保存位置。

当前只保留协议占位。

### 12. 日志与诊断

套件可以把前端错误、关键事件和诊断信息发送给主控，主控统一记录到平台日志或诊断面板。这样用户反馈问题时，主控可以看到套件侧的异常上下文。

协议消息：

- `suite:log:event`
- `suite:error:report`

蓝图场景：

- 前端未捕获异常。
- 接口请求失败。
- SDK 协议异常。
- 套件关键生命周期事件。

当前只保留协议占位。

上述 `suite:log:event` 和 `suite:error:report` 是浏览器诊断蓝图，不属于平台操作日志。关键业务操作必须由套件后端声明 `runtime.agent.capabilities: [operation-logs.write]`，并通过 Runtime SDK 调用 `/api/v1/agent/suite-runtime/operation-events`。

操作事件必须使用 UUIDv7 幂等键、稳定 lower snake case 事件码、中英文名称、明确结果和影响级别。Master 为用户发起的变更请求生成受信操作上下文，Agent 将其绑定到套件实例并向套件后端注入不透明上下文 ID；Runtime SDK 只负责原样回传。Agent 根据该上下文恢复平台用户、客户端 IP 和 trace ID，并使用令牌解析出的 suite ID、instance ID 和节点来源覆盖套件输入。套件不得声明或覆盖平台用户名、客户端 IP、模块和来源。不存在用户请求上下文的自主后台事件才以套件实例作为操作者。异步操作只记录一次提交和一次终态，查询、进度、界面偏好和敏感正文不进入操作日志。

### 13. 心跳与健康状态

主控需要知道 iframe 套件是否 ready、是否卡死、是否处于忙碌状态。心跳和健康状态可以为未来 watchdog、窗口状态提示和异常恢复提供基础。

协议消息：

- `suite:lifecycle:heartbeat`
- `suite:lifecycle:status`

蓝图状态：

- `ready`
- `busy`
- `idle`
- `error`

当前只保留协议占位。

## 套件端 API

```ts
const bridge = createSuiteBridge();
bridge.ready();

bridge.subscribeTheme((theme) => {
  console.log(theme.resolvedTheme);
  console.log(theme.glassEnabled);
});

bridge.destroy();
```

默认能力：

- `capabilities: ['theme', 'locale', 'notification', 'navigation', 'window']`
- `target: document`
- `targetOrigin: '*'`
- `applyTheme: true`

## 主控端 API

```ts
const bridge = createSuiteHostBridge({
  iframe: () => iframeElement,
  theme: () => currentTheme,
});

bridge.sendTheme();
bridge.destroy();
```

主控在以下时机发送主题：

- iframe load 后。
- 收到 `suite:lifecycle:ready` 后。
- 主控主题变化后。
- 主控 Liquid Glass 开关变化后。

## 独立运行

套件脱离主控直接访问时，SDK 使用：

```ts
window.matchMedia("(prefers-color-scheme: dark)");
```

并监听系统主题变化。

## 安全边界

首期以本地和内网部署快速落地为目标，默认 `targetOrigin: '*'`。

后续增强项：

- origin 白名单。
- capability 校验。
- RPC 超时。
- 协议契约测试。
- 主控上下文权限声明。

## 当前实现范围

- 套件端 Bridge。
- 主控端 Bridge。
- 主题同步。
- Liquid Glass 材质状态同步。
- 国际化同步。
- 主控通知。
- 主控导航。
- iframe 窗口聚焦。
- 独立运行主题降级。
- 为后续 RPC 保留消息字段。

## 路线图

首期必须实现：

- 主题同步。
- 国际化同步。
- 生命周期 ready。
- 基础 envelope。

近期实现：

- 主控上下文。
- 确认对话框。

中期实现：

- 窗口标题。
- 未保存状态。
- request/response RPC。

长期实现：

- 权限模型。
- 文件能力。
- 诊断上报。
- 心跳与健康状态。
