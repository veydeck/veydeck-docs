# Veydeck 套件系统实现规范

## 1. 范围

本文档定义 Veydeck Compose 套件在主控、Agent、应用库和桌面中的运行模型、数据边界、API 形态和交互约束。

本文档以当前套件系统 schema 和运行模型为准。

## 2. 领域模型

### 2.1 套件目录

套件目录由主控维护，记录可安装的套件包元数据。

核心属性：

| 字段 | 说明 |
| --- | --- |
| `suite_id` | 全局唯一套件 ID。 |
| `version` | 套件版本。 |
| `manifest_json` | `suite.yaml` 解析后的清单内容。 |
| `package_json` | 套件包快照。 |
| `checksum` | 套件包校验值。 |
| `status` | 目录状态。 |

套件目录不表示运行实例。导入套件只进入目录，不自动安装到任何节点。

### 2.2 套件实例

套件实例表示某个套件安装在某个节点上的运行单元。

核心属性：

| 字段 | 说明 |
| --- | --- |
| `instance_id` | 套件实例 ID。 |
| `suite_id` | 关联的套件目录 ID。 |
| `node_id` | 实例所属节点 ID；本地节点固定为 `local`。 |
| `compose_project_name` | Agent 侧 Docker Compose project 名称。 |
| `platform_contract_version` | 安装时从套件清单固化的平台运行契约版本。 |
| `status` | `installing`、`enabled`、`disabled`、`uninstalling`、`error` 等生命周期状态。 |

约束：

1. 同一节点上同一 `suite_id` 只能存在一个套件实例。
2. 同一套件可以分别安装到不同节点。
3. 如果同一节点需要多个副本，应使用 Docker 应用中的 Compose 项目自行维护，不应使用套件系统。

### 2.3 套件应用入口

套件应用入口由套件实例生成，进入当前节点的应用目录。

核心属性：

| 字段 | 说明 |
| --- | --- |
| `app_id` | 应用入口 ID，格式为 `suite:{instance_id}:{entry_id}`。 |
| `suite_instance_id` | 所属套件实例。 |
| `node_id` | 所属节点。 |
| `app_entry_id` | `suite.yaml` 中的入口 ID。 |
| `entry_type` | `proxied_web` 或 `compose_detail`。 |
| `entry_target` | 入口目标信息。 |

应用目录按 `nodeId` 查询。内置应用始终返回，套件应用只返回目标节点下已启用实例的入口。

### 2.4 平台运行契约

`suite.yaml.compatibility.platformContractVersion` 是套件与 Veydeck 平台运行边界的整数契约标识。当前平台支持版本集合来自 `release-compatibility.json`，当前包含 `1`。

主控必须满足以下约束：

1. 清单缺少 `compatibility` 或 `platformContractVersion` 时拒绝导入。
2. 值必须是正整数，并且属于当前平台支持的契约版本集合。
3. 安装时将目录清单中的值写入 `suite_instances.platform_contract_version`，后续检查使用实例快照，不从目录当前值反推。
4. 平台升级兼容性检查将实例契约版本与目标 Veydeck Release 声明的支持集合逐一比较。

该字段不进入 Agent Runtime 描述，也不替代 `metadata.minVeydeckVersion`。

## 3. 节点作用域

### 3.1 节点上下文

桌面和应用库以当前节点为上下文。

规则：

1. 切换节点后，应用库重新加载目标节点的应用目录。
2. 切换节点后，桌面重新加载目标节点的快捷方式布局。
3. 套件中心展示目标节点上的安装状态和实例状态。
4. 套件安装、启用、停用、卸载均作用于实例所属节点。

### 3.2 桌面布局

桌面快捷方式按 `(node_id, app_id)` 保存。

规则：

1. 内置应用在不同节点上可以有不同的桌面位置和显隐状态。
2. 套件应用的桌面记录只属于实例所在节点。
3. 自动排序只更新当前节点的桌面布局。
4. 用户删除某个节点上的套件快捷方式后，切换节点再返回不应自动恢复。
5. 新应用目录项首次出现且没有桌面记录时，可以由前端补位并保存。

## 4. 生命周期

### 4.1 导入

导入 `.vsp` 后，主控完成包解压、清单与资产校验，确认当前平台版本满足 `metadata.minVeydeckVersion`，并校验 `compatibility.platformContractVersion` 受当前平台支持后写入目录。

导入不访问节点，不创建实例，不生成桌面入口。

### 4.2 安装

安装请求必须携带目标节点，未携带时默认为 `local`。

流程：

1. 主控解析目标节点运行时，并读取导入时已校验的套件清单。
2. 主控检查目标节点 Docker 状态。
3. 主控创建安装任务和套件实例，并固化平台运行契约版本。
4. 主控解析 `compose.yaml` 与 `runtime.images`，得到套件运行需要的全部镜像。
5. 主控把 `runtime.agent.services`、`runtime.agent.capabilities` 与 `runtime.images` 作为实例授权发送给 Agent。
6. Agent 在目标节点复用已有镜像，并拉取缺失镜像。
7. Agent 在目标节点写入套件文件、执行 Compose 启动和健康检查，并向获授权服务注入 Runtime 描述与凭据。
8. 主控写入实例应用入口。
9. 前端按安装任务 ID 查询进度。

安装任务状态包含 `nodeId`，前端只应在对应节点上下文展示该任务。

### 4.3 启用与停用

启用实例：

1. 主控根据实例 `node_id` 访问目标 Agent。
2. Agent 启动 Compose 项目。
3. 主控恢复应用入口。
4. 桌面快捷方式按节点恢复。

停用实例：

1. 主控根据实例 `node_id` 访问目标 Agent。
2. Agent 停止 Compose 项目。
3. 主控删除应用入口。
4. 主控隐藏该节点下的套件桌面快捷方式，并记录停用前可见状态。

### 4.4 卸载

卸载实例只影响实例所属节点。

流程：

1. 主控请求目标 Agent 清理该实例创建的 suite workload 容器和取证任务。
2. 主控请求目标 Agent 停止并卸载 Compose 项目。
3. 主控删除该实例应用入口。
4. 主控删除该节点下的套件桌面记录。
5. 主控删除套件实例记录。

目录删除与实例卸载分离。存在任何实例时，不允许删除套件目录。

## 5. API 规范

### 5.1 应用与桌面

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/apps?nodeId={node_id}` | 查询目标节点应用目录。 |
| `GET` | `/api/v1/desktop/shortcuts?nodeId={node_id}` | 查询目标节点桌面快捷方式。 |
| `PUT` | `/api/v1/desktop/shortcuts?nodeId={node_id}` | 保存目标节点桌面快捷方式。 |

`nodeId` 省略时默认为 `local`。

### 5.2 套件目录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/suites/list?nodeId={node_id}` | 查询套件目录，并附带目标节点的实例状态。 |
| `POST` | `/api/v1/suites/import` | 导入套件包。 |
| `POST` | `/api/v1/suites/{suite_id}/install` | 在目标节点安装套件。 |
| `DELETE` | `/api/v1/suites/{suite_id}` | 删除套件目录。 |
| `GET` | `/api/v1/suites/{suite_id}/assets/{asset_path}` | 读取套件目录资产。 |

安装请求体：

```json
{
  "nodeId": "local"
}
```

### 5.3 安装任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/suite-install-tasks/{task_id}/progress` | 查询安装任务进度。 |
| `POST` | `/api/v1/suite-install-tasks/{task_id}/cancel` | 取消安装任务。 |

安装任务返回数据必须包含：

| 字段 | 说明 |
| --- | --- |
| `taskId` | 安装任务 ID。 |
| `instanceId` | 套件实例 ID。 |
| `nodeId` | 目标节点 ID。 |
| `progressPercent` | 进度百分比。 |
| `status` | `queued`、`running`、`canceling`、`success`、`failed`、`canceled`。 |
| `currentStep` | 当前阶段。 |
| `currentImage` | 当前处理镜像，可为空。 |
| `isFinished` | 任务是否结束。 |
| `error` | 错误信息，可为空。 |
| `cancelRequested` | 是否已请求取消。 |

### 5.4 套件实例

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/suite-instances/{instance_id}/enable` | 启用实例。 |
| `POST` | `/api/v1/suite-instances/{instance_id}/disable` | 停用实例。 |
| `POST` | `/api/v1/suite-instances/{instance_id}/uninstall` | 卸载实例。 |
| `GET` | `/api/v1/suite-instances/{instance_id}/assets/{asset_path}` | 读取实例资产。 |
| `ANY` | `/api/v1/suite-instances/{instance_id}/proxy/{entry_id}` | 代理入口请求。 |
| `ANY` | `/api/v1/suite-instances/{instance_id}/proxy/{entry_id}/{path}` | 代理入口子路径请求。 |

实例操作不接收 `nodeId` 参数。主控必须从实例记录解析目标节点。

### 5.5 平台升级兼容性检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/upgrades/release/{version}/compatibility/check` | 比较目标 Veydeck Release 支持的契约版本与已安装套件实例。 |

请求可以使用 `nodeIds` 限定节点范围。响应包含目标版本支持的契约版本集合、总体兼容状态、兼容/不兼容数量，以及每个实例的 `platformContractVersion`、状态和原因。

## 6. Agent 边界

Agent 只管理本节点运行时能力：

1. Docker 状态检查。
2. Compose 安装、启动、停止、卸载。
3. 安装进度采集。
4. 套件 Web 入口代理目标解析。
5. Suite Runtime workload 容器创建、查询、停止和删除。
6. 按 workload 全部已发布端点启动、停止 PCAP 取证并返回二进制结果。
7. 校验 Runtime 能力、服务身份和镜像白名单，并应用请求的资源限制。

Agent 不维护全局套件目录，不决定套件是否出现在其他节点。

本地节点的主控到 Agent 通信使用 Unix domain socket。外部节点使用 HTTPS，并由节点证书完成身份校验。套件运行容器不直接调用主控，必须通过主控注入的 Agent 访问配置调用本节点 Agent。

### 6.1 Suite Runtime 授权

只有 `runtime.agent.services` 中声明的 Compose 服务才能获得运行描述。当前描述至少包含：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 当前值为 `1`。 |
| `platformVersion` | Agent 所属 Veydeck 平台版本，供套件校验扩展资产的 `minVeydeckVersion`。 |
| `suiteId` / `instanceId` | 套件和安装实例的受信身份。 |
| `endpoint` | UDS 或 mTLS HTTPS 连接信息。 |
| `credential` | 当前实例的 Bearer token 及相关凭据。 |
| `capabilities` | 该实例获准调用的能力集合。 |

当前能力包括：

| 能力 | 允许的行为 |
| --- | --- |
| `workloads.manage` | 管理该套件实例拥有的具名 TCP/UDP 多端点 workload。 |
| `captures.manage` | 对该实例 workload 的全部已发布端点执行抓包。 |
| `operation-logs.write` | 提交语义化平台操作事件。 |

`runtime.images` 不写入 Runtime 描述。它由主控和 Agent 在安装时保存为实例级镜像白名单：既参与预拉取，也限制 workload 创建请求的 `image`。Compose 自身引用的镜像不会因此自动获得 workload 启动权限。

Agent 必须从令牌恢复套件与实例身份，不接受请求体覆盖；workload ID、capture ID 和操作事件均按实例隔离。套件停用或卸载时必须终止活动 capture 并删除该实例创建的 workload。

## 7. 前端交互标准

### 7.1 节点切换

节点切换后必须刷新：

1. 应用目录。
2. 桌面快捷方式。
3. 套件中心列表与当前节点实例状态。

已打开的当前节点应用应遵守窗口守卫策略。存在未完成操作、脏状态或活跃会话时，前端应阻止节点切换或要求用户先关闭相关窗口。

### 7.2 套件中心

套件中心以当前节点展示安装状态。

规则：

1. 未安装：显示安装入口。
2. 安装中：显示当前节点安装任务进度。
3. 已启用：显示停用和卸载入口。
4. 已停用：显示启用和卸载入口。
5. 目标节点 Docker 不可用时，不允许发起安装。

### 7.3 桌面

桌面展示当前节点的快捷方式。

规则：

1. 当前节点不存在的套件入口不得展示。
2. 当前节点用户隐藏过的快捷方式不得被自动恢复。
3. 当前节点新出现的应用入口可以自动补位。
4. 自动排序只对当前节点生效。

## 8. 数据一致性

实现必须满足以下约束：

1. `suite_instances` 对 `(suite_id, node_id)` 建立唯一约束。
2. `suite_app_entries` 必须保存 `node_id`。
3. `desktop_apps` 必须以 `(node_id, app_id)` 作为主键。
4. 应用目录查询必须按 `nodeId` 过滤套件入口。
5. 桌面读写必须按 `nodeId` 过滤。
6. 实例生命周期操作必须以实例记录中的 `node_id` 为准。
7. 套件实例必须保存安装时的 `platform_contract_version`，升级检查不得使用可变目录清单覆盖实例快照。
