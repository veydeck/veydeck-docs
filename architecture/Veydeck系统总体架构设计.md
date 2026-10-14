# Veydeck 系统总体架构设计

本文档定义 Veydeck 的系统级架构边界，用于说明组件职责、通信关系、数据流、安全边界和专题设计文档入口。项目介绍、技术栈和快速开始见仓库根目录 `README.md`。

---

## 1. 系统边界

Veydeck 由 Web Console、`veydeck` 主控、`veydeck-agent` 执行面、共享协议模型和本地持久化数据组成。

系统内职责：

1. 管理本地或远端节点。
2. 代理节点侧 Docker、文件、进程、终端和协议仿真能力。
3. 管理用户会话、节点身份、证书和运行时会话。
4. 持久化配置、节点状态、日志和升级计划。

系统外依赖：

1. Docker Engine 等节点本地运行时。
2. systemd、文件系统、进程和网络等宿主机能力。
3. GitHub Release 等升级制品来源。
4. 浏览器运行环境。

---

## 2. 架构边界图

```text
┌──────────────────────────────┐
│          Web Console          │
│       Vue 3 + Vite UI         │
└───────────────┬──────────────┘
                │ HTTP / WebSocket
                ▼
┌──────────────────────────────┐
│          veydeck 主控          │
│  API / Auth / Proxy / State   │
└───────┬───────────┬──────────┘
        │           │
        │           │ SQLite
        │           ▼
        │   ┌──────────────────┐
        │   │   veydeck.db       │
        │   │ 配置 / 节点 / 日志 │
        │   └──────────────────┘
        │
        │ mTLS / Unix Socket
        ▼
┌──────────────────────────────┐
│        veydeck-agent           │
│ System / Docker / FS / Shell  │
│ Simulation / Telemetry        │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│      节点本地系统能力         │
│ Docker / File / Process / OS  │
└──────────────────────────────┘
```

---

## 3. 组件职责边界

### 3.1 Web Console

职责：

1. 提供用户交互入口。
2. 调用 `veydeck` 暴露的 `/api/v1` 接口。
3. 维护前端视图状态和用户操作流。

边界：

1. 不直接访问任意 Agent。
2. 不保存认证 token。
3. 不自行决定节点在线状态。

### 3.2 `veydeck` 主控

职责：

1. 用户认证与服务端 Session 管理。
2. 节点库存、身份、注册会话和生命周期管理。
3. 本地 Agent 或远端 Agent 的 HTTP / WebSocket 代理。
4. 任务调度、协议仿真编排、在线升级调度。
5. 平台日志、运行日志查询和审计事件聚合。

边界：

1. 不直接执行节点本地系统操作。
2. 不绕过 Agent 访问远端主机资源。
3. 不把前端本地状态作为节点状态事实来源。

### 3.3 `veydeck-agent`

职责：

1. 暴露节点本地系统能力。
2. 执行 Docker、文件、进程、终端等操作。
3. 提供本地遥测和运行日志。
4. 执行协议仿真、PCAP 取证和节点侧升级。
5. 通过注册、心跳和证书链路接受主控纳管。

边界：

1. 不提供 Web Console。
2. 不管理全局节点库存。
3. 不接受未纳管主控的运行时请求。

### 3.4 共享协议与契约

职责：

1. 定义共享 DTO、API 响应和错误码。
2. 提供安全基础设施和证书相关能力。
3. 通过类型生成流程保持前后端契约一致。

---

## 4. 运行模式边界

### 4.1 本地模式

`veydeck` 与本机 `veydeck-agent` 运行在同一主机。主控通过 Unix Socket 访问本地 Agent。

适用场景：

1. 单机实验环境。
2. 开发调试。
3. 未纳管远端节点时的默认本地能力入口。

### 4.2 分布式模式

`veydeck` 管理多个远端 `veydeck-agent`。主控通过 HTTPS/mTLS 与 Agent 建立受信通信。

适用场景：

1. 多节点安全实验环境。
2. 跨主机 Docker、文件、终端和仿真操作。
3. 节点统一纳管、升级和日志查询。

---

## 5. 关键数据流

### 5.1 用户操作流

1. 用户在 Web Console 发起操作。
2. 前端调用 `veydeck` API。
3. `veydeck` 完成认证、鉴权和目标节点解析。
4. 本地请求通过 Unix Socket 转发到本地 Agent。
5. 远端请求通过 mTLS 转发到目标 Agent。
6. Agent 执行节点侧操作并返回结果。

### 5.2 节点纳管流

1. 主控创建节点记录和 enrollment token。
2. 部署流程安装并启动 `veydeck-agent`。
3. Agent 使用 token 发起首次注册。
4. 主控建立节点身份、证书和活跃会话。
5. Agent 周期性心跳续租。

### 5.3 日志与观测流

1. 平台日志记录业务事件并写入数据库。
2. 运行日志由 `tracing` 写入轮转文件。
3. 前端通过平台日志应用查询事件日志和运行日志。
4. 远端 Agent 日志通过主控代理统一读取。

---

## 6. 安全边界

Veydeck 的安全边界按三层划分：

1. **浏览器到主控**：使用 HttpOnly Cookie 和服务端 Session 管理登录态。
2. **主控到 Agent**：本地模式使用 Unix Socket，分布式模式使用 HTTPS/mTLS。
3. **Agent 到系统能力**：Agent 以节点侧权限访问 Docker、文件系统、进程、终端和网络能力。

安全原则：

1. 前端不保存认证 token。
2. 远端 Agent 必须完成受控纳管后才能接入。
3. 节点身份、证书和运行时会话必须绑定。
4. 高权限操作必须记录平台日志或审计事件。

---

## 7. 数据与运行态边界

生产环境默认使用 `/opt/veydeck` 作为数据和运行态根目录：

```text
/opt/veydeck/
├── config/
├── database/
├── data/
│   └── compose/
│       ├── docker/
│       └── suite/
├── logs/
└── run/
```

二进制入口安装在 `/usr/local/bin`，并在 `/usr/bin` 创建软链接。目录布局细节见部署目录规范文档。

---

## 8. 部署与升级边界

部署链路负责安装二进制、写入配置、注册 systemd 服务并启动 Agent。在线升级链路负责同步 Release、校验制品、创建升级计划并推动主控或 Agent 完成替换。

部署与升级都必须保持节点身份、配置、日志和数据库状态可追踪。

---

## 9. 相关文档

- [VeydeckCrate架构设计规范.md](VeydeckCrate架构设计规范.md)：Rust Workspace Crate 职责与依赖关系。
- [Veydeck分布式部署与节点管理路线图.md](Veydeck分布式部署与节点管理路线图.md)：多节点架构实现状态与后续规划。
- [../standards/Veydeck平台分布式部署设计与目录规范.md](../standards/Veydeck平台分布式部署设计与目录规范.md)：生产部署目录与 systemd 规范。
- [../standards/Veydeck单用户认证与会话管理设计.md](../standards/Veydeck单用户认证与会话管理设计.md)：Web 控制台认证与 Session 模型。
- [../operations/Veydeck运行时协议与运维手册.md](../operations/Veydeck运行时协议与运维手册.md)：Agent 注册、心跳、状态机和运维流程。
- [../standards/Veydeck平台日志设计规范.md](../standards/Veydeck平台日志设计规范.md)：平台日志和运行日志设计。
- 控制面 API 当前实现清单由 `veydeck` 仓库的 `docs/api-docs/` 维护。
