# Veydeck WebSocket 基础设施设计规范

## 目的

本文定义 WebSocket 基础设施的设计范围。当前使用场景是容器实时日志；通知历史与审计日志通过数据库查询接口提供。

为了在后续功能中可靠地推送实时事件（例如日志、通知、监控数据等），需要一套**通用、可复用的 WebSocket 基础设施**。该基础设施应满足：

- 后端能够根据客户端订阅按需推送特定事件流（如容器日志）；
- 前端能够通过统一机制按需订阅或取消订阅事件，自动处理连接、重连、状态提示与清理；
- 运行在 `veydeck`/`agent` 架构下，所有客户端的 WebSocket 请求依然走到控制层（`veydeck` 服务代理）再转发到 `agent` 服务。

## 后端设计 (Agent 服务)

`agent` 服务负责实际的事件处理和 WebSocket 管理。

1. **统一入口**：`/api/v1/agent/websocket/events/ws` 是 WebSocket 服务的统一入口点。所有 WebSocket 连接都通过此端点建立和升级。
2. **`handle_socket` 函数**：
    - 每个成功的 WebSocket 升级都会创建一个独立的异步任务，由 `handle_socket` 函数管理。
    - `handle_socket` 将客户端的 WebSocket 连接分割为独立的发送端和接收端。
    - 它维护一个 `LogTaskMap` (`HashMap<String, JoinHandle<()>>`) 来管理当前客户端所有活跃的日志流任务，其中键是 `container_id`。
    - 它启动一个 `send_task`，通过一个 MPSC (Multi-Producer, Single-Consumer) 通道将服务器内部生成的 `ServerWsMessage`（如日志行）发送给客户端。
3. **消息协议 (`ClientWsMessage` & `ServerWsMessage`)**：
    - 定义了清晰的客户端-服务器消息协议。客户端发送 `ClientWsMessage` (例如 `SubscribeLogs`, `UnsubscribeLogs`) 来请求数据。
    - 服务器发送 `ServerWsMessage` (例如 `Snapshot`, `Append`, `End`, `Error`, `Heartbeat`) 来推送数据和状态。
    - 消息体中包含 `container_id`，允许前端根据 ID 路由消息。
4. **`spawn_log_streaming_task` (日志流任务)**：
    - 当 `handle_socket` 收到 `SubscribeLogs` 消息时，会为此 `container_id` 启动一个独立的异步任务。
    - 该任务负责使用 `bollard` 客户端与 Docker 守护进程交互，获取容器的初始日志快照，并以 `ServerWsMessage::Snapshot` 发送。
    - 随后，它会实时流式传输新的日志行，以 `ServerWsMessage::Append` 发送。
    - 它处理日志流的结束 (`ServerWsMessage::End`) 和错误 (`ServerWsMessage::Error`)。
    - 任务在客户端取消订阅或 WebSocket 连接断开时会被中止。
5. **核心服务 (veydeck) 代理**：`veydeck` 服务作为 `agent` 服务的前置代理。所有来自前端的 `/api/v1/agent/websocket/...` 请求都会被 `veydeck` 服务代理到 `agent` 服务，包括 WebSocket 升级请求。`veydeck` 服务不终止 WebSocket 连接，而是将它们转发到 `agent` 服务进行实际处理。

## 前端设计

1. **`useWebSocket` Composable**：这是一个底层的 Vue Composable，负责管理单个 WebSocket 连接的生命周期。
    - 它封装了连接、断开、发送消息、自动重连等核心逻辑。
    - 它以响应式状态 (`connected`, `connecting`, `lastMessage`, `lastError` 等) 暴露连接状态和接收到的原始消息。
2. **`useWebSocketStore` (Pinia Store)**：这是一个全局的 Pinia Store，作为前端 WebSocket 逻辑的核心管理者。
    - 它内部使用 `useWebSocket` 来管理实际的连接。
    - 它实现了**引用计数（基于 `subscriptions` Set）**：当有组件需要 WebSocket 连接（例如订阅日志）时，它才调用 `useWebSocket` 的 `connect`；当所有组件都取消订阅时，它才调用 `disconnect`。
    - 它提供 `subscribeToContainerLogs` 和 `unsubscribeFromContainerLogs` 等高层动作，供业务组件调用。
    - 它负责解析 `lastMessage` 为类型化的 `ServerWsMessage`，并根据消息类型进行初步处理（如通知）。
3. **业务组件**：例如 `DockerContainerLogsModal.vue`。
    - 它不再直接使用 `useWebSocket`，而是通过 `useWebSocketStore` 来管理日志订阅。
    - 当组件可见时，调用 `wsStore.subscribeToContainerLogs(containerId)`。
    - 当组件关闭或卸载时，调用 `wsStore.unsubscribeFromContainerLogs(containerId)`。
    - 它监听 `wsStore.lastMessage`，并根据消息中的 `container_id` 过滤，只处理与自身相关的日志。

## 重用场景

- **容器日志**：当前实现中，容器的实时日志流通过此基础设施进行管理和推送。
- **通知中心**：如未来需要推送“实时通知事件”，可复用该链路；当前通知历史已由 `veydeck` 数据库持久化，不依赖 WebSocket 保存。
- **未来扩展**：该基础设施可以很容易地扩展到其他实时数据流，如监控指标、事件中心等，只需定义新的 `ClientWsMessage` 和 `ServerWsMessage` 类型，并在 `agent` 的 `handle_socket` 中添加相应的处理逻辑。

## 注释与维护

- 所有 WebSocket 链路都应在注释中注明“走 veydeck → agent 路径”，防止误把客户端直接指向 agent。
- `useWebSocket` 内部通过 `manualClose`/`autoReconnect` 标志区分用户主动断开与意外断开，避免误判重连逻辑。
- `useWebSocketStore` 中的 `subscriptions` Set 管理引用计数，确保连接按需建立和关闭。
