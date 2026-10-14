# Veydeck 在线升级设计规范

本文档定义 Veydeck 在线升级功能的架构、数据模型、执行流程、安全约束与验收边界。在线升级支持 GitHub Release 同步和管理员上传完整版本包两种制品来源；当前代码已落地 GitHub Release 链路，上传完整版本包链路为待实现设计。

---

## 1. 目标与范围

### 1.1 设计目标

- 统一管理 `veydeck` 主控与 `veydeck-agent` 节点的版本升级。
- 从 GitHub Release 或管理员上传完整版本包获取升级制品，由主控缓存、校验并分发给节点。
- controller 与 agent 按同一版本一起发布、一起上传、一起升级；用户入口统一采用集群升级模式。
- 支持主控升级时继续保留升级计划状态，服务重启后可继续收敛。
- 支持在线节点立即升级，离线节点上线后自动补齐升级。
- 支持在升级前比较目标 Release 与已安装套件的平台运行契约版本。
- 所有升级计划、目标和事件必须持久化，便于审计与排障。

### 1.2 当前实现范围

- 已实现 GitHub Release 元数据同步。
- 已实现升级计划、目标、事件和制品下载令牌的数据模型。
- 已实现主控缓存 Release 制品并校验 SHA256。
- 已实现 agent 从主控下载制品并执行本地替换、重启和回滚接口。
- 已实现主控后台调度器推进 controller 与 agent 升级目标。
- 已实现设置页在线升级入口、版本列表、计划目标和事件展示。
- 已实现目标 Release 套件契约支持集合解析、已安装套件兼容性检查和结果展示。
- 待实现管理员上传完整版本包、发布签名验签、上传制品校验入库和基于上传来源的集群升级计划创建。
- 真实生产升级链路需要等正式 Release 或上传制品准备完成后进行端到端验收。

---

## 2. 架构总览

在线升级采用制品来源、主控和节点三层结构：

```text
GitHub Release            管理员上传完整版本包
      │                       │
      └───────────┬───────────┘
                  ▼
veydeck 主控
    - 同步 Release 元数据
    - 接收上传完整版本包
    - 下载、缓存或落盘制品
    - 校验 SHA256
    - 使用内置发布公钥校验签名
    - 创建升级计划
    - 调度主控与节点升级目标
    │
    ▼
veydeck-agent 节点
    - 从主控下载授权制品
    - 二次 SHA256 校验
    - 二次签名校验
    - 备份当前二进制
    - 替换并重启服务
```

关键约束：

- agent 仅从主控下载授权升级制品。
- 前端所有升级操作统一提交到主控。
- agent 下载升级制品必须使用主控签发的短期 token。
- 主控是升级计划、目标状态和事件流水的唯一真相源。
- GitHub Release 与上传完整版本包只是制品来源差异，升级计划、目标调度和 agent 下载协议必须保持一致。
- 对外统一暴露集群升级语义；controller 与 agent target 是主控内部执行单元。
- 套件兼容性检查使用实例安装时固化的 `platform_contract_version`，并与目标 Release 的 `supportedSuiteContractVersions` 比较。

---

## 3. 配置项

主控配置位于 `veydeck.toml` 的 `upgrade` 配置段。

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `releaseRepository` | GitHub 仓库，格式为 `owner/repo` | `owner/veydeck` |
| `releaseChannel` | Release 通道，支持 `stable` 与 `prerelease` | `stable` |
| `assetPattern` | 对外完整版本包名称模板，支持 `{version}` 与 `{target}`；`{target}` 必须使用规范化 `targetTriple` | `veydeck-{version}-{target}.tar.gz` |
| `downloadCacheDir` | 主控制品缓存目录；GitHub 下载和上传文件都落在该目录下 | `/opt/veydeck/cache/releases` |
| `githubToken` | 私有仓库或高频 API 访问使用的 GitHub Token | 空 |
| `checksumAssetName` | 固定 checksum 文件名；为空时自动查找 `.sha256` 或 checksum 资产 | 空 |
| `controllerAutoRestart` | 主控替换二进制后是否自动重启 systemd 服务 | `true` |

目标设计采用 SHA256 摘要和 Ed25519 detached signature 双校验：SHA256 用于传输完整性和缓存一致性，`.sig` 签名用于证明制品由 Veydeck 发布私钥签发。发布私钥只存在于发布流程或离线签名环境，运行时程序只内置发布公钥。

公钥内置方案：

- 重构阶段由维护者直接提供发布公钥。
- 在仓库中新增发布公钥常量模块，例如 `crates/veydeck-upgrade/src/signing_key.rs`，导出 `VEYDECK_RELEASE_PUBLIC_KEY`。
- `veydeck` 主控和 `veydeck-agent` 统一依赖该常量模块执行验签，避免两端公钥漂移。
- 发布公钥只能通过源码常量内置，不支持配置文件、运行时环境变量或构建期环境变量覆盖。
- 公钥解析失败时服务启动阶段直接报错，避免升级链路进入无可信验签状态。

发布流水线使用 Veydeck 专属签名环境变量：

| 环境变量 | 说明 |
| --- | --- |
| `VEYDECK_SIGNING_PRIVATE_KEY` | 发布私钥内容或私钥文件路径，仅在构建与签名阶段注入 |
| `VEYDECK_SIGNING_PRIVATE_KEY_PASSWORD` | 发布私钥密码，按私钥生成策略可为空 |

上述环境变量只允许出现在 CI/CD secret 或离线签名机环境中；主控配置、数据库、Release 元数据和 agent 运行环境只保存公钥、签名文件和签名校验结果。

---

## 4. 数据模型

### 4.1 `upgrade_releases`

记录可用于升级的版本元数据。记录来源可以是 GitHub Release，也可以是管理员上传的本地完整版本包。

核心字段：

- `version`：标准 SemVer 版本，入库值使用去除 `v` 前缀后的规范化格式。
- `tag_name`：GitHub 原始 tag；上传来源使用规范化版本号。
- `channel`：`stable` 或 `prerelease`。
- `source`：版本来源，支持 `github` 与 `upload`。
- `release_url`：GitHub Release 页面地址；上传来源使用 `upload://{release_id}`。
- `assets`：制品 JSON 摘要，GitHub 来源记录 Release assets，上传来源记录主控本地缓存制品；每个制品摘要必须包含 `component`、`targetTriple`、文件名、大小、SHA256 和签名状态。
- `checksum_status`：checksum 元数据状态。
- `signature_status`：发布签名校验状态，取值与 `checksum_status` 对齐，支持 `unknown`、`missing`、`verified`、`failed`。
- `supported_suite_contract_versions`：目标 Release 支持的套件平台运行契约版本集合，以正整数 JSON 数组保存。
- `synced_at`、`published_at`：同步和发布时间；上传来源的 `published_at` 可以为空。

### 4.2 `upgrade_plans`

记录一次升级计划。

核心字段：

- `target_version`：计划目标版本。
- `component`：保留 `controller`、`agent` 或 `cluster` 枚举；当前管理 API 只允许创建 `cluster` 计划。
- `scope`：节点范围与是否包含离线节点。
- `strategy`：并发数与失败阈值配置。
- `status`：`draft`、`running`、`paused`、`succeeded`、`failed`、`canceled`。

### 4.3 `upgrade_targets`

记录计划中的单个升级目标。

目标类型：

- `controller`：主控服务，`node_id` 为空。
- `agent`：节点执行面，`node_id` 指向目标节点。

目标状态：

- `pending`：等待调度。
- `deferred`：目标节点离线，等待上线后继续。
- `running`：已开始执行。
- `succeeded`：目标版本已确认生效。
- `failed`：执行失败。
- `rollbacked`：已回滚。
- `canceled`：已取消。

### 4.4 `upgrade_events`

记录升级事件流水。事件用于 UI 展示、审计和排障。

### 4.5 `upgrade_artifact_tokens`

记录 agent 下载主控制品时使用的短期授权 token。

约束：

- token 以 SHA256 hash 入库，仅在签发响应中返回明文。
- token 绑定 `plan_id`、`target_id`、`version`、`component`、`target_triple`。
- token 默认 30 分钟过期。

### 4.6 套件实例契约快照

`suite_instances.platform_contract_version` 保存套件安装时从 `suite.yaml.compatibility.platformContractVersion` 固化的值。兼容性检查按未卸载实例逐项读取该字段，并返回：

- `compatible`：目标 Release 的支持集合包含该实例契约版本。
- `incompatible`：目标 Release 不支持该实例契约版本，原因为 `contractVersionNotSupported`。

可以通过 `nodeIds` 只检查指定节点。检查结果不修改套件实例、目录或升级计划。

---

## 5. API 设计

### 5.1 前端管理 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/upgrades/releases/list` | 查询可用升级版本 |
| `POST` | `/api/v1/upgrades/releases/sync` | 从 GitHub 同步 Release 元数据 |
| `POST` | `/api/v1/upgrades/releases/upload` | 上传本地完整版本包并写入版本记录 |
| `POST` | `/api/v1/upgrades/release/{version}/compatibility/check` | 检查目标版本与已安装套件的平台运行契约兼容性 |
| `POST` | `/api/v1/upgrades/plan/create` | 创建升级计划 |
| `POST` | `/api/v1/upgrades/plan/{plan_id}/start` | 启动升级计划 |
| `GET` | `/api/v1/upgrades/plan/{plan_id}/detail` | 查询升级计划详情 |
| `POST` | `/api/v1/upgrades/plan/{plan_id}/cancel` | 取消未执行目标 |

`POST /api/v1/upgrades/plan/create` 当前接受 `component=cluster`，省略 `component` 时按 `cluster` 处理；controller 与 agent 的 target 由主控在 cluster 计划内自动展开。

兼容性检查响应包含 `releaseVersion`、`supportedSuiteContractVersions`、总体 `compatible` 状态、数量汇总和实例明细。实例明细包含套件、节点、`platformContractVersion`、状态及原因。

`POST /api/v1/upgrades/releases/upload` 使用 `multipart/form-data`，字段如下：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 是 | 目标 SemVer 版本，可带 `v` 前缀，入库前统一规范化 |
| `channel` | 是 | `stable` 或 `prerelease` |
| `targetTriple` | 是 | 完整版本包的目标平台标识，必须符合本文的 `targetTriple` 规范 |
| `sha256` | 是 | 完整版本包文件的 SHA256 摘要 |
| `signature` | 是 | 完整版本包的 detached signature，建议文件名为 `veydeck-{version}-{targetTriple}.tar.gz.sig` |
| `file` | 是 | 完整版本包，文件名必须符合 `veydeck-{version}-{targetTriple}.tar.gz` |

处理规则：

1. 校验版本号、通道、目标平台和完整版本包文件名。
2. 流式接收上传文件并写入临时文件。
3. 计算临时文件 SHA256，与请求字段 `sha256` 严格匹配。
4. 使用内置发布公钥校验完整版本包签名。
5. 解包完整版本包，要求同时包含 controller 与 agent 制品、各自 SHA256 文件和各自 `.sig` 签名文件。
6. 校验包内 controller 与 agent 制品 SHA256 和签名后，将制品移动到 `{downloadCacheDir}/{version}/{component}/{targetTriple}/{artifact_name}`。
7. 写入或更新 `upgrade_releases`，其中 `source=upload`、`release_url=upload://{release_id}`、`checksum_status=verified`、`signature_status=verified`。
8. 若同版本已存在且 `source=github`，系统以 GitHub 来源记录为准，上传请求记录来源校验结果。
9. 若同版本同 `targetTriple` 已存在且 `source=upload`，SHA256 和签名相同按幂等上传处理；任一校验值变化按制品一致性校验失败处理。
10. 若同版本不同 `targetTriple` 已存在且 `source=upload`，允许追加该架构的完整版本包，合并到同一版本记录的 `assets`。

### 5.2 agent 升级 API

所有路径均通过主控代理访问 agent。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/agent/upgrade/status` | 查询本地升级状态 |
| `POST` | `/api/v1/agent/upgrade/prepare` | 下载并校验目标二进制 |
| `POST` | `/api/v1/agent/upgrade/apply` | 替换当前二进制并重启 |
| `POST` | `/api/v1/agent/upgrade/rollback` | 使用备份二进制回滚 |

### 5.3 runtime 制品下载 API

agent 从主控下载制品使用 runtime 公共接口：

```text
GET /api/v1/runtime/upgrades/artifacts/{version}/{component}/{target_triple}/download?token={token}
```

处理规则：

1. 校验 token 存在、处于有效期内且作用域匹配。
2. 根据 `upgrade_releases.source` 查找目标制品。
3. GitHub 来源在本地缓存缺失时由主控从 GitHub 下载完整版本包三件套，校验完整版本包 SHA256 与签名后解包缓存组件制品。
4. 上传来源直接读取本地缓存；缓存状态纳入制品可用性校验。
5. `target_triple` 与目标节点上报的平台标识精确一致，制品选择采用精确匹配策略。
6. 返回制品内容，并通过 `x-veydeck-sha256` 和 `x-veydeck-signature` 响应头返回 SHA256 与 detached signature。

---

## 6. 执行流程

### 6.1 Release 同步

1. 管理员在设置页点击同步版本。
2. 主控调用 GitHub Releases API。
3. 主控按通道要求过滤 Release。
4. 主控解析 SemVer、完整版本包三件套、发布时间、checksum 状态和签名状态。
5. 主控写入或更新 `upgrade_releases`，版本来源为 `github`。

### 6.2 上传完整版本包

1. 管理员在设置页选择上传完整版本包。
2. 前端提交 `multipart/form-data`，包含版本、通道、目标平台、完整版本包 SHA256、签名和文件。
3. 主控校验元数据和文件名，接收完整版本包到临时路径。
4. 主控计算完整版本包 SHA256，并使用内置发布公钥校验完整版本包签名。
5. 主控解包后校验包内 controller 与 agent 制品的 SHA256 和签名，并移动到制品缓存目录。
6. 主控写入或更新 `upgrade_releases`，版本来源为 `upload`。
7. 上传成功后，版本进入统一版本列表，可用于创建升级计划。

上传来源以完整版本包为最小接收单元，单次上传同时提供同版本 controller 与 agent 制品。主控保存的 `assets` 摘要必须包含两个组件制品的文件名、本地缓存路径对应的下载标识、文件大小、content type、SHA256 和签名状态。

### 6.3 套件兼容性检查

1. 管理员在目标版本操作区发起套件兼容性检查。
2. 主控读取目标 Release 的 `supported_suite_contract_versions`；GitHub 来源尚未解析时，下载并验签对应完整版本包中的 `release.json`。
3. 主控按请求节点范围查询所有未卸载套件实例的 `platform_contract_version`。
4. 每个实例按集合包含关系标记为 `compatible` 或 `incompatible`。
5. 前端展示总体结果、支持的契约版本集合以及不兼容的套件和节点。

兼容性检查是只读预检，不改变套件或升级计划状态。

### 6.4 创建并启动升级计划

1. 管理员选择目标版本并启动集群升级。
2. 主控创建 `upgrade_plans`。
3. 当前设计只允许创建 `cluster` 计划，主控创建：
   - 一个 `controller` target。
   - 所有符合范围的 `agent` target。
4. 主控校验目标版本对主控和所有目标节点涉及的 `targetTriple` 都同时包含 controller 与 agent 制品。
5. 在线节点 target 初始为 `pending`。
6. 离线节点 target 初始为 `deferred`。
7. 启动计划后，计划状态变为 `running`。

### 6.5 主控升级

1. 调度器扫描到 `controller` target。
2. 主控缓存并校验 controller 制品 SHA256 和签名。
3. 主控备份当前二进制到缓存目录下的 `controller-backup/veydeck.prev`。
4. 主控替换当前运行二进制。
5. 若处于生产布局且允许自动重启，执行 `systemctl restart veydeck`。
6. 重启后调度器再次扫描，若当前版本等于目标版本，则 target 标记为 `succeeded`。

### 6.6 agent 升级

1. 调度器扫描到 `agent` target。
2. 若节点无活跃会话，target 保持或转为 `deferred`。
3. 若节点在线，主控生成短期制品下载 token。
4. 主控拼接 runtime 制品下载 URL，并调用 agent `prepare`。
5. agent 从主控下载二进制，校验 SHA256 和签名，写入暂存文件。
6. 主控调用 agent `apply`。
7. agent 备份当前二进制，替换当前二进制。
8. 生产布局下 agent 执行 `systemctl restart veydeck-agent`。
9. agent 重启并重新注册后，调度器轮询 `status`。
10. 当 agent 当前版本等于 target 版本，target 标记为 `succeeded`。

### 6.7 离线节点补偿

离线节点进入延迟执行状态。

处理规则：

- 计划创建时离线：target 初始为 `deferred`。
- 调度时离线：target 转为 `deferred`。
- 节点上线后：会话恢复，调度器重新推进该 target。
- agent 在线后执行升级；执行失败时，target 进入 `failed`。

---

## 7. 制品与校验规范

GitHub Release 和上传来源对外都只提供完整版本包三件套：完整版本包、checksum 和 `.sig` 签名。完整版本包内部包含 controller 与 agent 组件制品、组件 checksum 和组件签名。

完整版本包还必须包含已签名的 `release.json`，其中声明目标平台和套件契约支持集合：

```json
{
  "version": "0.1.0-alpha.1",
  "channel": "prerelease",
  "targetTriple": "linux-x86_64",
  "publishedAt": "2026-08-11T00:00:00Z",
  "compatibility": {
    "supportedSuiteContractVersions": [1]
  }
}
```

`supportedSuiteContractVersions` 必须是非空、无重复且只包含正整数的数组。同一 Release 的不同 `targetTriple` 包必须声明完全相同的集合。

### 7.1 `targetTriple` 规范

`targetTriple` 是制品选择的稳定平台标识，必须贯穿包名、缓存路径、资产摘要、token 作用域和 runtime 下载路径。

命名规则：

- 采用 `{os}-{arch}` 格式，全部小写，只允许 ASCII 字母、数字、下划线和短横线。
- `os` 使用运行系统名称，例如 `linux`。
- `arch` 使用 Veydeck 规范化架构名，例如 `x86_64`、`aarch64`。
- 当前已支持 `linux-x86_64`；未来新增架构时按同一规则增加，例如 `linux-aarch64`。
- 节点注册、心跳或升级状态中上报的平台标识必须与制品 `targetTriple` 使用同一套规范。

选包规则：

- 主控为 controller target 使用主控自身的 `targetTriple`。
- 主控为 agent target 使用目标节点最近一次上报的 `targetTriple`。
- 创建或启动计划时，目标版本必须具备所有目标平台对应的 controller 与 agent 制品。
- 精确匹配的 `targetTriple` 是制品选择前置条件；匹配成功后计划进入启动流程或目标进入调度流程。

### 7.2 包名规范

对外完整版本包命名：

```text
veydeck-{version}-{targetTriple}.tar.gz
veydeck-{version}-{targetTriple}.tar.gz.sha256
veydeck-{version}-{targetTriple}.tar.gz.sig
```

包内组件制品命名：

```text
veydeck-{targetTriple}.tar.gz
veydeck-{targetTriple}.tar.gz.sha256
veydeck-{targetTriple}.tar.gz.sig

veydeck-agent-{targetTriple}.tar.gz
veydeck-agent-{targetTriple}.tar.gz.sha256
veydeck-agent-{targetTriple}.tar.gz.sig
```

主控组件对外统一命名为 `veydeck`，节点组件对外统一命名为 `veydeck-agent`；`controller` 仅作为升级计划内部目标类型使用，不出现在组件制品文件名中。

示例：

```text
veydeck-0.1.0-alpha.1-linux-x86_64.tar.gz
veydeck-0.1.0-alpha.1-linux-x86_64.tar.gz.sha256
veydeck-0.1.0-alpha.1-linux-x86_64.tar.gz.sig
```

上传完整版本包 `veydeck-{version}-{targetTriple}.tar.gz` 必须在包内包含 controller 与 agent 制品、对应 `.sha256` 文件和对应 `.sig` 文件。主控校验完整版本包 SHA256 和签名后，还必须校验包内两个组件制品的 SHA256 和签名。

### 7.3 checksum 规范

checksum 文件用于快速定位传输损坏和缓存一致性问题，支持两种格式：

```text
<sha256>
```

或：

```text
<sha256>  <artifact-file-name>
```

主控处理 GitHub 制品时必须校验 checksum asset；处理上传完整版本包时必须校验请求中的包 SHA256 和包内组件 SHA256。agent prepare 阶段还会使用主控传入的组件 SHA256 做二次校验。

### 7.4 签名规范

发布签名用于证明制品来自 Veydeck 发布私钥。签名算法采用 Ed25519 detached signature，签名对象为原始 `.tar.gz` 文件字节。

签名文件命名：

```text
<artifact-file-name>.sig
```

签名规则：

- 发布流程在编译完成后使用发布私钥为完整版本包和包内组件制品分别签名。
- 发布私钥通过 `VEYDECK_SIGNING_PRIVATE_KEY` 注入，私钥密码通过 `VEYDECK_SIGNING_PRIVATE_KEY_PASSWORD` 注入。
- 发布私钥仅存在于发布流程或离线签名环境。
- `veydeck` 主控和 `veydeck-agent` 程序内置同一个发布公钥常量，公钥内容由维护者在重构阶段提供。
- GitHub 来源从 Release asset 读取完整版本包 `.sig` 文件。
- 上传来源从 multipart 字段读取完整版本包签名，并从包内读取组件 `.sig` 文件。
- 主控验签通过后写入版本记录；agent prepare 阶段对下载到的组件制品执行二次验签。
- 签名校验通过是制品进入可分发状态的前置条件。

上传制品额外约束：

- `file` 原始文件名必须与 `version` 和 `targetTriple` 匹配。
- 同一个 `version`、`targetTriple` 只能对应一个完整版本包。
- 同一个 `version` 可以存在多个 `targetTriple` 的完整版本包，用于多架构集群升级。
- 同名完整版本包重复上传时，SHA256 和签名相同按幂等上传处理；校验值变化按制品一致性校验失败处理。
- 上传来源以完整版本包为接收单元，包内同时包含 controller 与 agent 单个组件制品。
- 上传来源的制品必须持久保存到 `downloadCacheDir`。

---

## 8. 回滚与失败处理

### 8.1 agent 回滚

agent `apply` 前会备份当前二进制：

```text
/opt/veydeck/run/upgrades/veydeck-agent.prev
```

调用 `POST /api/v1/agent/upgrade/rollback` 后，agent 使用备份二进制覆盖当前二进制，并按生产布局规则重启服务。

### 8.2 主控回滚

主控升级前备份当前二进制：

```text
{downloadCacheDir}/controller-backup/veydeck.prev
```

当前代码实现了主控升级备份和替换；主控自动回滚 helper 作为后续增强项。若新版本启动异常，通过运维方式恢复备份二进制。

### 8.3 状态收敛

调度器按以下规则收敛目标状态：

- agent prepare/apply/status 请求成功后继续推进目标。
- agent 返回的升级状态通过目标一致性校验后，目标进入后续确认流程。
- checksum 校验通过后，制品进入可分发状态。
- 签名校验通过后，制品进入可信可分发状态。
- 目标版本已登记且目标平台制品齐备时，目标进入调度流程。
- 上传来源本地缓存命中时，runtime 下载接口返回对应制品。
- 上传完整版本包文件名、目标平台、包内组件、SHA256 和签名通过一致性校验后，版本进入可用状态。
- 主控二进制替换成功且重启后版本确认一致时，controller target 标记为 `succeeded`。
- 上述推进条件未满足时，目标标记为 `failed` 并写入可诊断事件。

---

## 9. 前端入口

入口：

```text
设置 -> 在线升级
```

设计目标 UI 支持：

- 同步 Release。
- 上传完整版本包。
- 查看版本列表、checksum 状态和签名校验状态。
- 查看版本来源，区分 GitHub 与本地上传。
- 检查目标版本与已安装套件的平台运行契约兼容性，并列出不兼容实例。
- 选择目标版本。
- 创建并启动集群升级计划。
- 查看计划状态、目标状态与事件流水。

后续 UI 扩展项：

- 上传完整版本包入口。
- 节点范围选择。
- 手动取消计划按钮。
- 手动回滚按钮。

除上传链路外，上述能力后端已有部分基础；上传完整版本包需要补充管理 API、制品入库和前端入口。

---

## 10. 验收边界

代码级验证已覆盖：

- Rust 编译、格式化与 clippy。
- 前端格式化、lint 与 build。
- checksum 文本解析单元测试。
- 签名验签单元测试。

生产端到端验收需等待正式 Release 或上传制品准备完成后执行，至少覆盖：

1. 主控同步真实 GitHub Release。
2. 主控下载并校验 controller 与 agent 制品。
3. 管理员上传包含 controller 与 agent 的完整版本包，版本列表出现 `source=upload` 记录。
4. 上传 SHA256 校验失败时，版本记录保持 `checksum_status=failed`。
5. 上传签名校验失败时，版本记录保持 `signature_status=failed` 并写入诊断事件。
6. 上传包组件完整性校验覆盖 controller 与 agent 两个组件制品。
7. 同版本上传多个 `targetTriple` 完整版本包后，不同架构节点下载各自精确匹配的制品。
8. 目标节点具备匹配 `targetTriple` 制品时，计划启动并按精确架构分发。
9. 主控自身升级并重启后收敛成功。
10. 在线 agent 升级并重新注册后收敛成功。
11. 离线 agent 上线后自动补齐升级。
12. checksum 或签名校验失败时，目标停留在可诊断的失败状态。
13. agent apply 失败后可通过 rollback 恢复。
14. 套件兼容性检查按目标 Release 支持集合正确汇总兼容与不兼容实例，并支持节点范围过滤。
