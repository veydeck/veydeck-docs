# Veydeck 平台日志设计规范

## 1. 目标

平台日志用于记录 Veydeck 应用自身发生的关键业务事件，并提供后台入库、分页查询、条件筛选和前端查看能力。

这里的“系统日志”指 Veydeck 平台自身的应用系统日志，不是宿主机操作系统日志，也不是容器实时输出日志。

日志体系拆分为两条链路：

- **平台日志**：结构化业务事件，写入数据库，用于平台日志应用查询。
- **运行日志**：`tracing` 运行日志，写入轮转日志文件，用于排障查询，不写入业务数据库。

两者共享 `trace_id`、`request_path`、`method`、`source` 等关联字段，但存储、查询和生命周期相互独立。

## 2. 非目标

以下内容不纳入平台日志表：

- 宿主机 `/var/log`、`journalctl`、syslog 等操作系统日志。
- 容器 stdout/stderr 实时日志。
- 全量 `tracing::debug/info/warn/error` 运行日志。
- 前端临时 toast 通知历史。

容器实时日志继续通过 WebSocket 或 Agent 侧 Docker 接口提供；通知历史继续使用通知模块；运行日志使用轮转文件查询接口。

## 3. 语言策略

Veydeck 日志体系必须区分“系统内部记录”和“用户界面展示”。

系统内部记录统一使用英文：

- 后端 `tracing` message。
- 平台日志 `event`、`source`、`target_type`、`metadata` key。
- 平台日志中可检索、可分析的 `metadata` value，例如状态、错误码、动作、对象类型。
- 运行日志 JSON Lines 中的 `message` 与结构化字段。
- API 错误详情中用于开发和排障的原始错误信息。

用户可见文本由前端负责本地化：

- 前端根据 `event`、`module`、`status`、`error_code`、`message_key` 映射中文或英文文案。
- 后端不得把中文自然语言句子写入平台日志数据库或运行日志文件。
- 如需在平台日志详情中展示可读摘要，后端写入 `message_key` 与 `message_params`，前端再做 i18n 渲染。

禁止示例：

```json
{
  "event": "<SCREAMING_SNAKE_CASE_EVENT>",
  "metadata": {
    "message": "<localized_user_facing_sentence>"
  }
}
```

推荐示例：

```json
{
  "event": "user_login",
  "metadata": {
    "message_key": "platformLog.auth.userLogin.success",
    "message_params": {
      "username": "admin"
    }
  }
}
```

## 4. 平台日志

### 4.1 语义

平台日志记录的是业务事实，而不是普通打印信息。

典型事件包括：

- 认证：登录成功、登录失败、刷新凭据失败、登出。
- 节点：节点注册、上线、离线、部署、卸载、预检失败。
- 运行时：会话注册、租约刷新、证书轮换、代理请求失败。
- 任务：任务创建、派发、执行完成、执行失败。
- 配置：监听地址变更、危险操作确认。
- Docker：容器启动、停止、删除、镜像删除等平台发起的操作。

领域层或应用层负责确定事件语义；平台日志服务只负责标准化写入和查询。

```text
Auth / Node / Runtime / Task / Docker / Veydeck
        │
        ▼
PlatformLogEvent / PlatformLogEntry
        │
        ▼
platform_logs
        │
        ▼
平台日志应用：事件日志页签
```

### 4.2 事件命名

`event` 是平台日志的稳定事件名，必须使用英文 `snake_case`。

推荐事件名：

- `user_login`
- `user_login_failed`
- `user_refresh_token`
- `user_logout`
- `node_precheck`
- `node_deploy_create`
- `node_deploy`
- `node_upgrade`
- `node_repair`
- `node_retire`
- `node_uninstall`
- `runtime_enroll`
- `runtime_register`
- `runtime_heartbeat`
- `runtime_deregister`
- `runtime_rotate_certificate`
- `veydeck_network_update`
- `docker_container_started`
- `docker_container_stopped`
- `docker_container_restarted`
- `docker_container_removed`

禁止使用：

- SCREAMING_SNAKE_CASE 事件名。
- `NodeRegistered`
- `Node.Registered`
- 中文事件名或中英文混合事件名。

### 4.3 数据模型

数据库表使用 `platform_logs`。当前处于初始开发阶段，不保留旧表兼容。

字段保持稳定、可查询：

| 字段 | 说明 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | 操作用户 ID，可为空 |
| `username` | 操作用户或系统主体 |
| `module` | 业务模块，如 `Auth`、`Node`、`Runtime`、`Task`、`Docker`、`Veydeck` |
| `event` | 稳定 `snake_case` 事件名，如 `user_login`、`node_registered` |
| `target_type` | 目标类型，如 `user`、`node`、`task` |
| `target_id` | 目标 ID 或名称 |
| `timestamp` | 事件发生时间，UTC ISO-8601 |
| `status` | `SUCCESS` 或 `FAILED` |
| `client_ip` | 请求客户端 IP；后台任务可使用 `127.0.0.1` 或空来源约定 |
| `trace_id` | 请求或后台任务关联 ID |
| `source` | 来源端，如 `veydeck`、`agent`、`frontend`、`veydeck_api` |
| `request_path` | HTTP 请求路径；后台任务可为空 |
| `method` | HTTP 方法；后台任务可为空 |
| `metadata` | 英文结构化 JSON 上下文，禁止保存密码、token、私钥等敏感内容 |

索引要求：

- `timestamp DESC`
- `(module, event)`
- `status`
- `user_id`
- `trace_id`
- 可选：`target_type, target_id`

### 4.4 Metadata 规范

`metadata` 用于保存可检索、可分析、可脱敏的上下文，不用于保存直接展示给用户的自然语言句子。

字段命名规则：

- key 使用英文 `snake_case`。
- ID、状态、错误码、数量、耗时、路径、节点名等使用明确字段。
- 错误详情使用 `error` 或 `error_code`，值必须是英文。
- 可展示摘要使用 `message_key` 和 `message_params`。

推荐：

```json
{
  "message_key": "platformLog.node.deploy.failed",
  "message_params": {
    "node_name": "lab-node-01"
  },
  "node_id": "0198...",
  "error_code": "node_deploy_failed",
  "duration_ms": 1280
}
```

不推荐：

```json
{
  "message": "<localized_user_facing_sentence>",
  "error": "<localized_error_sentence>"
}
```

### 4.5 共享契约

共享契约统一从 `veydeck-contracts` 生成到前端：

- `PlatformLog`
- `PlatformLogQuery`
- `PlatformLogList`
- `LogModule`
- `LogStatus`
- `PlatformLogEntryDraft`

`PlatformLogList` 继续使用 `logs` 字段作为列表字段，不引入第二套 `items` 命名。

### 4.6 API

平台日志查询 API：

```text
POST /api/v1/platform/logs
```

请求体为 `PlatformLogQuery`：

```json
{
  "page": 1,
  "pageSize": 20,
  "modules": ["Auth", "Node"],
  "events": ["user_login"],
  "eventPrefixes": ["node_", "task_"],
  "statuses": ["SUCCESS", "FAILED"],
  "startAt": 1767225600000,
  "endAt": 1769903999000,
  "keyword": "node-01"
}
```

查询规则：

- 默认返回所有模块的平台日志。
- 按 `timestamp DESC` 排序。
- `startAt` / `endAt` 使用 Unix epoch milliseconds，服务端统一转换为 UTC 时间后查询数据库。
- `keyword` 匹配 `username`、`event`、`target_id`、`trace_id`、`request_path`。
- 不对 `metadata` 做深度 JSON 搜索；前端详情可根据 `message_key`、`message_params` 和结构化字段渲染。
- `pageSize` 应设置上限，避免一次读取过大。

响应为 `ApiResponse<PlatformLogList>`。

### 4.7 写入规则

平台日志写入必须遵循：

- 只记录业务事件，不把普通 `tracing` event 自动写入平台日志表。
- 写入失败不影响主业务流程。
- 写入失败必须通过 `tracing::error` 记录，运行日志 message 使用英文。
- 事件名必须稳定，不能把自然语言文案作为 `event`。
- 敏感数据只允许写入脱敏摘要，禁止写入明文凭据。
- 后台任务事件必须生成 `trace_id`，便于和运行日志关联。
- 平台日志 `metadata` 不写中文自然语言；用户文案由前端 i18n 负责。

推荐调用形态：

```rust
PlatformLogEntry::new("admin", "user_login", client_ip)
    .module(LogModule::Auth)
    .target_type("user")
    .target_id("admin")
    .trace_id(&trace_id)
    .request("POST", "/api/v1/auth/login")
    .metadata(json!({
        "message_key": "platformLog.auth.userLogin.success",
        "message_params": {
            "username": "admin"
        }
    }))
    .set_success()
    .finish(&state.db);
```

## 5. 运行日志

### 5.1 语义

运行日志来自 `tracing`，用于定位程序运行状态、错误堆栈、后台任务异常和请求链路问题。

运行日志不写入 `platform_logs`，因为它具备高频、低业务语义、排障导向等特点。它应通过轮转文件保留，并提供只读查询接口。

运行日志 message 必须使用英文。用户界面如果需要展示运行日志说明文案，由前端额外本地化；运行日志原文保持系统内部英文记录。

```text
tracing event/span
        │
        ├── console layer：人类可读
        │
        └── file layer：JSON Lines 轮转文件
                  │
                  ▼
          平台日志应用：运行日志页签
```

### 5.2 文件位置

默认日志目录：

- 开发环境：`.veydeck/logs/veydeck/`、`.veydeck/logs/agent/`
- 生产环境：默认由 `VEYDECK_HOME=/opt/veydeck` 推导到 `/opt/veydeck/logs/veydeck/`、`/opt/veydeck/logs/agent/`，也可通过 `VEYDECK_LOG_DIR` 单独覆盖日志根目录。

如果日志目录创建失败，服务必须降级为仅输出控制台日志，不能因为文件日志不可用而启动失败。

建议环境变量：

- `VEYDECK_HOME`：生产应用根目录，默认 `/opt/veydeck`。
- `VEYDECK_LOG_DIR`：单独覆盖基础日志目录。
- `RUST_LOG`：控制日志级别过滤。

### 5.3 文件格式

运行日志文件采用 JSON Lines，每行一个 JSON object。

必须包含的基础字段：

| 字段 | 说明 |
| --- | --- |
| `timestamp` | 本地或 UTC 时间，推荐 RFC3339 |
| `level` | `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR` |
| `target` | Rust tracing target |
| `message` | 英文日志消息 |
| `service` | `veydeck` 或 `agent` |
| `span` | 当前 span 信息，可为空 |
| `fields` | 结构化字段 |

如果 tracing event 中存在以下字段，应原样保留：

- `trace_id`
- `request_id`
- `method`
- `path`
- `status`
- `node_id`
- `node_name`
- `session_id`
- `task_id`

推荐：

```rust
tracing::info!(
    node_id = %node_id,
    node_name = %node_name,
    "Node registered successfully"
);
```

不推荐：

```rust
tracing::info!("节点 {node_name} 注册成功");
```

### 5.4 轮转策略

默认策略：

- 按天轮转。
- veydeck 和 agent 分目录保存。
- 文件名包含服务名和日期，例如 `veydeck.log.2026-05-29`。
- 后续可增加保留天数或最大文件数量配置。

初始实现不压缩历史文件；如果日志量增长，再增加压缩和清理策略。

### 5.5 查询接口

运行日志查询只读轮转文件，不导入数据库。

建议 API：

```text
GET  /api/v1/platform/runtime-logs/files
POST /api/v1/platform/runtime-logs/query
```

文件列表返回：

- 文件名
- 服务名
- 节点 ID：`agent` 日志必须返回，`veydeck` 日志为空
- 节点名称：`agent` 日志优先返回用户可识别的 `nodeName`
- 日期
- 文件大小
- 修改时间

查询参数：

- `service`: `veydeck | agent`
- `nodeId`: 查询 Agent 日志时使用；本地 Agent 为 `local`，远端 Agent 使用节点 ID
- `file`: 指定日志文件
- `level`: 可选
- `target`: 可选
- `keyword`: 可选
- `limit`: 返回行数上限
- `cursor`: 继续读取位置

查询结果：

- `lines`: 日志行数组
- `nextCursor`: 下一次读取位置
- `hasMore`: 是否还有更多内容

实现约束：

- 只能读取允许目录下的日志文件。
- 禁止路径穿越。
- 单次读取必须有限制，避免读取超大文件阻塞服务。
- JSON 解析失败的行可以作为 raw line 返回，并标记 `parseError`。
- 分布式 Agent 日志通过 Veydeck 主控统一入口查询。主控根据 `nodeId` 选择本地 Unix socket 或远端 HTTPS 节点运行时，再把 `nodeName` 补充到文件列表，前端展示必须优先使用 `nodeName`，无名称时再回退到 `nodeId`。

## 6. 前端应用

前端提供“平台日志”应用作为统一入口。

应用内分两个页签：

- **事件日志**：查询数据库 `platform_logs`。
- **运行日志**：查询 veydeck/agent 的 JSON Lines 轮转文件。

事件日志保留当前筛选能力：

- 模块
- 动作前缀
- 状态
- 关键词
- 时间范围
- 分页

运行日志提供：

- 服务选择：veydeck / agent
- Agent 节点选择：显示节点名称，内部使用 `nodeId` 查询
- 文件选择
- level 过滤
- target 或关键词过滤
- 增量加载

前端展示规则：

- UI 文案统一使用“平台日志”。
- 模块、动作、状态、错误码和 `message_key` 必须通过 i18n 映射展示。
- 事件详情可以展示结构化字段，但字段标签由前端本地化。
- 禁止依赖后端中文 `message` 作为主要展示来源。
- 涉及合规含义时，可在说明中写“平台日志可用于关键操作追踪”。
