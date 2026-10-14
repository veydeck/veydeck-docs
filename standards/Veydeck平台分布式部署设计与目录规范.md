# Veydeck Platform 分布式部署设计与目录规范

本规范定义了 **Veydeck Platform** 生产环境下的标准部署架构、主控端（`veydeck`）与执行面（`veydeck-agent`）的物理目录拓扑，以及平台一致性的备份与恢复策略。

---

## 1. 部署路径规范

生产部署路径按职责分离：

1. `VEYDECK_HOME` 固定为 `/opt/veydeck`。
2. 配置、数据库、日志、Socket 等数据和运行态文件存放在 `/opt/veydeck`。
3. `veydeck`、`veydeck-agent` 与 `slctl` 的实体文件安装到 `/usr/local/bin`。
4. 安装流程固定创建 `/usr/bin` 软链接，指向 `/usr/local/bin` 中的实体文件。
5. 首次执行 `deploy/install.sh` 时，安装流程在端口确定后提示默认回连主机；用户回车时使用脚本检测到的主网卡 IPv4，最终写入 `config/runtime-listen.json` 的 `publicHost`。
6. 主控首次启动签发服务端证书时，SAN 必须覆盖本地地址、主机名、`<hostname>.lan` 与默认回连主机；已有证书不由启动流程自动重签。

---

## 2. 主控端 (`veydeck`) 生产部署规范

主控面通常部署在核心管理节点或公网云服务器上。其部署拓扑结构如下：

### 2.1 物理目录拓扑

```text
/opt/veydeck/                # 主控端安装家目录 (VEYDECK_HOME)
├── config/
│   ├── veydeck.toml         # 主控端静态配置文件
│   ├── runtime-listen.json # 加密的运行时网络监听配置 (AES-256-GCM)
│   └── runtime-listen.key  # 保护上述 json 密钥的 32字节 Hex 秘钥文件
├── database/
│   └── veydeck.db           # SQLite 核心配置与状态元数据库
├── logs/
│   └── veydeck/
│       └── veydeck.log      # 主控运行日志 (JSON Lines 规范)
└── run/
    └── ...                 # 运行时目录，预留给 Socket 等短生命周期文件
```

主控二进制路径：

```text
/usr/local/bin/veydeck       # 实体文件
/usr/bin/veydeck             # 指向 /usr/local/bin/veydeck 的软链接
```

### 2.2 systemd 服务编排 (`/etc/systemd/system/veydeck.service`)

```ini
[Unit]
Description=Veydeck Control Service
After=network.target

[Service]
Type=simple
User=veydeck                 # 推荐使用受限的系统专用用户运行
Group=veydeck
WorkingDirectory=/opt/veydeck
Environment=VEYDECK_HOME=/opt/veydeck
ExecStart=/usr/local/bin/veydeck
Restart=always
RestartSec=5
LimitNOFILE=65535           # 高并发 WebSocket 连接代理保障

[Install]
WantedBy=multi-user.target
```

---

## 3. 被控端 (`veydeck-agent`) 生产部署规范

被纳管节点通常分布于局域网或各隔离云主机的 Linux 系统中。当主控通过 **SSH 自动化机制**（配合 `deploy/slctl` 脚本）进行推送分发时，会强制在目标主机建立以下结构：

### 3.1 物理目录拓扑

```text
/opt/veydeck/                # 执行端安装家目录 (VEYDECK_HOME)
├── config/
│   └── agent.toml          # 自动生成的 Agent 受控运行配置文件
├── database/
│   └── agent.db            # SQLite 本地指标采样与遥测缓存数据库
├── data/
│   └── compose/
│       ├── docker/         # Docker 应用创建的普通 Compose 项目
│       └── suite/          # 套件中心安装的 Compose 项目
├── run/
│   └── veydeck-agent.sock   # 运行时套接字 (如果启用本地 Unix Domain Socket 通信)
└── logs/
    └── agent/
        └── agent.log       # Agent 周期采样与遥测运行日志
```

> [!IMPORTANT]
> **二进制入口规范**：
>
> - `/usr/local/bin/veydeck-agent`：实体文件
> - `/usr/local/bin/slctl`：实体文件
> - `/usr/bin/veydeck-agent`：指向 `/usr/local/bin/veydeck-agent` 的软链接
> - `/usr/bin/slctl`：指向 `/usr/local/bin/slctl` 的软链接

### 3.2 systemd 服务编排 (`/etc/systemd/system/veydeck-agent.service`)

该服务在 SSH 推送部署的最后阶段创建并启动：

```ini
[Unit]
Description=Veydeck Distributed Telemetry Agent
After=network.target

[Service]
Type=simple
User=root                   # Agent 需要收集系统指标、配置防火墙与容器，需 root 权限运行
WorkingDirectory=/opt/veydeck
Environment=VEYDECK_HOME=/opt/veydeck
ExecStart=/usr/local/bin/veydeck-agent
Restart=always
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

---

## 4. 备份、恢复与迁移策略

备份恢复分为产品入口、CLI 入口和目录级冷备份。

### 4.1 产品级备份导出与恢复导入

Web Console 提供备份导出与恢复导入能力，由后端生成和校验标准化备份包：

1. **备份导出**：管理员在前端触发导出后，后端收集配置、SQLite 数据库、运行时监听配置、证书与密钥材料、节点注册元数据等必要内容，生成带版本信息和校验摘要的备份包。
2. **恢复导入**：管理员上传备份包后，后端先校验包结构、版本兼容性、校验摘要和权限，再执行恢复流程。
3. **审计记录**：每次导出和导入都应写入平台审计日志，记录操作者、时间、备份范围和恢复结果。
4. **敏感数据保护**：备份包中的密钥、证书和令牌材料必须按平台安全策略加密或要求管理员显式确认导出。

### 4.2 CLI 运维备份与恢复

在 Web Console 不可访问、需要自动化运维或执行离线迁移时，可以通过 `slctl backup` 与 `slctl restore` 提供等价的命令行能力。CLI 备份包格式应与产品级备份包保持一致，避免形成两套恢复语义。

### 4.3 目录级冷备份

当平台服务不可用且 CLI 工具无法执行时，管理员可以停服后冷备份 `/opt/veydeck`。该方式只覆盖配置、数据库、日志和运行态文件，不覆盖 `/usr/local/bin` 下的二进制实体、`/usr/bin` 软链接、systemd unit、系统用户、权限、防火墙等系统级安装状态。

使用目录级冷备份恢复到新主机后，必须重新执行安装或修复流程，恢复 `/usr/local/bin` 执行入口、systemd 服务文件和必要的系统权限，再启动对应服务。

---

## 5. 分布式 SSH 推送部署二进制获取流程与环境差异

主控端在通过 SSH 自动化分发和拉起分布式子节点时，需要提取**主控宿主机本地**的 `veydeck-agent` 二进制文件与 `slctl` 控制脚本并推送给目标主机。系统设计了开发与生产自适应的智能检索策略：

### 5.1 开发环境 (Debug 模式) 二进制智能感知

在本地开发模式下（`cfg!(debug_assertions)` 为真时），为了避免开发者由于没有安装全局命令而导致部署测试失败，主控会自动依据 `workspace_root()` 动态向上递归检索项目工作空间，并采用**自适应探测机制**：

1. **首选开发产物**：优先检测本地编译生成的 Debug 产物：`{workspace_root}/target/debug/veydeck-agent`；
2. **次选 Release 产物**：若上者缺失，自动退一步检测 Release 编译产物：`{workspace_root}/target/release/veydeck-agent`；
3. **开发期控制脚本**：自动定位并提取工作空间下的开发版脚本：`{workspace_root}/deploy/slctl`；
4. **前置阻断防护**：如果二者编译产物均不存在，则会抛出明确错误以指引开发者执行 `cargo build`。

### 5.2 生产环境 (Release 模式) 二进制标准路径

在生产环境下（`cfg!(debug_assertions)` 为假时），主控端在分发节点时，会以硬性的标准生产目录为准：

1. **默认主控本地二进制路径**：**`/usr/local/bin/veydeck-agent`**（该路径也是本地一键安装脚本默认置入主控本地系统的物理位置）；
2. **默认主控本地控制脚本路径**：**`/usr/local/bin/slctl`**；
3. 如果用户在 `config.toml` 中配置了其他自定义路径，则以配置文件优先。

### 5.3 SSH 分发与部署推进流程

当主控解析并核实本地这两个分发源存在后，将按以下顺序推进 SSH 安全分发：

1. **前置拦截校验**：远程连接后，在目标机器强前置校验 CPU 架构（必须为 `x86_64`）并执行 `sudo -n true` 测试是否具备免密 Sudo 权限。不通过立即 `BadRequest` 拦截，防止交互挂起。
2. **物理目录建立**：在被控机上递归创建 `/opt/veydeck/{config,database,logs,run}` 与 `/usr/local/bin`（对齐 `/opt/veydeck` 数据面基准路径，拒绝多重嵌套 `/opt/veydeck/veydeck`）。
3. **SFTP 安全分发**：
   - 将主控本地的 `veydeck-agent` 推送至被控端：`/usr/local/bin/veydeck-agent`；
   - 将主控本地的 `slctl` 运维脚本推送至被控端：`/usr/local/bin/slctl`；
4. **链接与授权**：在远程机上执行链接授权动作，创建 `/usr/bin/veydeck-agent` 指向 `/usr/local/bin/veydeck-agent`，创建 `/usr/bin/slctl` 指向 `/usr/local/bin/slctl`。
5. **服务拉起**：将 systemd 模板渲染（全局替换占位符为真实的 `/opt/veydeck`）并写入远程主机的 `/etc/systemd/system/veydeck-agent.service` 并执行重载拉起。
