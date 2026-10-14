# Veydeck Crate 架构设计规范

本文档定义 Veydeck (Security Lab Platform) 整个 Rust Cargo Workspace 项目中各个 Crate（模块）的职责划分、逻辑边界与依赖拓扑关系。

---

## 1. 核心模块与职责

### 1.1 `veydeck` (控制面 - Control Plane)

- **定位**：Veydeck 分布式架构下的全局主控面服务，属于系统唯一的管理入口与真相源。
- **主要职责**：
  - [x] **Web API 端点**：向 Web UI Console 前端控制台暴露认证、节点管理、任务调度、平台关于、关于配置、系统审计等 RESTful 与 WebSocket API。
  - [x] **节点管理 (Node Inventory)**：维护分布式节点的静态资产建档、在线会话状态与生命周期变迁。
  - [x] **安全通信守护**：管理私 CA 证书签发与轮换，维护 `veydeck-agent` 连接的强身份信任链。
  - [x] **运行时代理 (Runtime Proxy)**：动态解析请求，将面向特定分布式节点的 HTTP/WebSocket 会话安全、幂等地路由代理中继至对应的 Agent。
  - [x] **任务调度与计划**：管理异步任务状态机并驱动 Cron 式周期性任务。
- **依赖关系**：
  - [x] `veydeck-api` (通用规范)
  - [x] `veydeck-contracts` (前后端契约)
  - [x] `veydeck-security` (安全与 CA)

---

### 1.2 `veydeck-agent` (执行面 - Execution Plane)

- **定位**：部署于各宿主机物理节点上的轻量级自治守护进程，专门负责与控制面交互并执行底层指令。
- **主要职责**：
  - [x] **能力暴露**：向控制面安全暴露本机的系统状态、Docker 容器监控、文件系统管理、交互式终端 Shell 与进程遥测能力。
  - [x] **注册与续租**：启动后基于 enrollment token 主动纳管，并周发心跳包（Heartbeat）维持运行时会话租约（Lease TTL）。
  - [x] **安全反向请求接收**：基于 mTLS 双向认证屏障接收并安全执行由 `veydeck` 转发中继的运行时请求。
  - [x] **本地快照与采样**：周期采样节点硬件负载（CPU/内存），生成缓存性能指标以供心跳上报。
- **依赖关系**：
  - [x] `veydeck-api`
  - [x] `veydeck-contracts`
  - [x] `veydeck-security`

---

## 2. 共享基础模块

### 2.1 `veydeck-api` (通用规范接口)

- **定位**：系统统一的 API 交互规约、错误码体系与底层通信数据结构抽象。
- **主要职责**：
  - [x] 定义标准响应包装体 `ApiResponse<T>` 与通用错误结构 `ApiError`。
  - [x] 提供统一的 API 分页数据格式 `Pagination`。
  - [x] 收敛与规范分布式会话冲突、租约超期、部署失败等通用底层错误码。

### 2.2 `veydeck-contracts` (前后端共享数据模型 - DTOs)

- **定位**：纯粹的数据传输模型（Data Transfer Objects）定义层，充当前后端强类型协作的契约桥梁。
- **主要职责**：
  - [x] 承载用户登录、审计日志、通知消息、进程管理、遥测指标等所有交互数据模型。
  - [x] 仅包含数据结构（Structs & Enums），严格不包含具体业务逻辑。
  - [x] 使用 `ts-rs` 特性，配合单测，一键自动生成并更新前端所用的 TypeScript 接口类型声明。

### 2.3 `veydeck-security` (安全基础设施)

- **定位**：提供金融级安全的证书认证中心（CA）、双向 TLS 握手及加解密算法基础包。
- **主要职责**：
  - [x] **CA 证书管理**：生成、管理系统根私有证书材料，签发节点通信证书。
  - [x] **双向 mTLS 认证**：提供控制面与 Agent 进行通信时的 TLS 客户端与服务端配置凭证，封禁非法或未受管节点的接入。
  - [x] **加解密算法**：对高风险凭据（如 SSH 密码、密钥）进行安全非对称加密与哈希处理。

---

## 3. 未来与预留领域模块

### 3.1 `veydeck-runtime` (虚拟运行时抽象)

- **定位**：为未来平台支持更丰富的底座（除 Docker 外）而设计的运行时统一抽象隔离层。
- **主要职责**：
  - [x] 预留并定义 `Runtime` 抽象 Trait（生命周期建立、销毁、资源控制）。
  - [ ] 后期计划实现并集成 Docker、Podman、Firecracker 极速微虚拟机及 AD 域（Active Directory Lab）等多元化底座运行时代理。

### 3.2 `veydeck-scenario` (安全场景仿真引擎)

- **定位**：Veydeck 平台面向「场景优先（Scenario-First）」的顶层业务编排系统。
- **主要职责**：
  - [x] 预留 `Scenario` 生命周期控制、版本比对、可调度性预检等 Trait 契约。
  - [ ] 负责管理 Wordpress、Jenkins 等漏洞场景模板库（Scenario Template Registry），驱动其多节点一键编排和秒级沙箱环境部署。

---

## 4. Workspace 模块分层与依赖架构

整个 Rust Cargo Workspace 各模块之间遵守单向依赖、严格分层的工程设计约束：

```text
       ┌────────────────────────┐
       │     frontend (Vue)     │
       └───────────┬────────────┘
                   │
                   ▼ (HTTP / WebSocket 代理)
┌──────────────────────────────────────────────────┐
│              veydeck (Control Plane)              │
└───────────┬──────────────┬──────────────┬────────┘
            │              │              │
            │              │              ▼
            │              │   ┌───────────────────┐
            │              │   │  veydeck-scenario  │ (Future Domain)
            │              │   └───────────────────┘
            │              ▼
            │     ┌─────────────────┐
            │     │ veydeck-runtime  │ (Future Domain)
            │     └─────────────────┘
            ▼
┌──────────────────────────────────────────────────┐
│          veydeck-agent (Execution Plane)          │
└───────────┬──────────────┬──────────────┬────────┘
            │              │              │
            ▼              ▼              ▼
┌───────────────────┐┌──────────────┐┌───────────────┐
│  veydeck-contracts ││  veydeck-api  ││veydeck-security│ (Shared Core)
└───────────────────┘└──────────────┘└───────────────┘
```

### 依赖规则约束

1. **控制面不得逆向依赖**：`veydeck` 可以依赖 `veydeck-agent` 的某些 DTO，但绝不允许 `veydeck-agent` 反向编译依赖 `veydeck` 控制面实体。
2. **共享模块绝对独立**：`veydeck-api`、`veydeck-contracts` 和 `veydeck-security` 绝不允许引入任何上层业务逻辑，必须保持极度的轻量、无状态与高效编译。
