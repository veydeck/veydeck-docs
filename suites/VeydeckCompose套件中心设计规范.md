# Veydeck Compose 套件中心设计规范

## 1. 背景

Veydeck 当前已经具备 Docker 与 Docker Compose 项目的基础管理能力，包括 Compose 项目创建、校验、启动、停止、重启、更新、删除、日志查看和服务伸缩。套件中心不应重新实现一套运行时，而应建立在现有 Compose 能力之上，把“手写 Compose 项目”提升为“可分发、可安装、可启用、可出现在应用库中的产品化套件”。

套件中心的定位是控制面能力，不承担业务进程运行。实际容器、网络、卷、镜像拉取和 Compose 命令执行仍由 `veydeck-agent` 完成。

## 2. 目标

1. 用户可以在套件中心浏览、导入、安装、启用、停用和卸载 Compose 套件。
2. 套件安装后可以向应用库注册入口，用户按现有应用流程点击使用或添加到桌面。
3. 主控 `veydeck` 只保存套件目录、安装意图、实例状态和应用入口元数据，不直接执行套件业务逻辑。
4. Agent 负责在目标节点落地套件文件、执行 `docker compose`、采集运行状态和返回日志。
5. 套件按节点安装，同一套件可以分别安装到本地节点或外部节点。

## 3. 非目标

1. 不在主控进程内加载第三方插件代码。
2. 不支持任意系统级 `.deb` 套件安装。
3. 不把套件做成浏览器内 JavaScript 插件系统。
4. 不在 v1 阶段实现跨节点 Compose 调度、服务发现和分布式一致性编排。
5. 套件中心使用独立的数据模型，不复用内置应用的运行时状态表。

## 4. 核心概念

| 名称 | 定义 |
| --- | --- |
| 应用库 | Veydeck 现有的应用入口集合，负责展示可打开的应用图标。 |
| 应用 | 用户可点击打开的 UI 入口，可以是内置应用，也可以是套件注册出来的入口。 |
| 套件 | 以 Compose 为运行单元分发的一组服务、配置、图标、说明和应用入口声明。 |
| 套件中心 | 内置应用，用于管理套件仓库、安装状态和生命周期操作。 |
| 套件包 | 可导入的套件交付物，包含 `suite.yaml`、`compose.yaml`、资源文件和说明文档。 |
| 套件实例 | 某个套件版本在某个目标节点上的一次安装结果。 |
| Compose 项目 | Agent 上实际执行的 Docker Compose project，是套件实例的运行载体。 |

## 5. 总体架构

```text
用户
  |
  v
Web Console
  |
  v
veydeck 主控控制面
  |  保存套件目录、安装记录、应用入口、审计日志
  |
  v
节点通信层
  |
  v
veydeck-agent 执行面
  |  写入套件文件、校验 Compose、执行 docker compose、采集状态
  |
  v
Docker / Docker Compose
```

职责边界：

| 模块 | 职责 |
| --- | --- |
| 前端套件中心 | 展示套件目录、安装表单、运行状态、生命周期操作和日志入口。 |
| 前端应用库 | 按“内置应用”和“套件应用”分组展示应用入口。 |
| `veydeck-ui` | 发布 VDL Token、自有图标、Vue 基础组件和套件集成 SDK，不承载套件业务逻辑。 |
| `veydeck` | 维护套件元数据、安装意图、目标节点、应用入口、权限策略和审计记录。 |
| `veydeck-agent` | 管理 Compose 文件目录、执行 Compose 命令、读取容器状态和日志。 |
| Docker Compose | 负责真实容器编排和生命周期。 |

## 6. 套件包格式

套件包统一使用 `.vsp` 后缀。文件名使用 `{suite_id}-{version}.vsp`，包类型由内部 `suite.yaml` 清单的 `kind: suite` 明确声明。

`.vsp` 内部载荷采用 gzip 压缩的 tar 归档，可直接使用标准工具检查、打包和排障。主控导入时必须校验归档可解析性、包内路径安全性、`suite.yaml` 清单及其 `kind` 字段，不应只信任文件名。

`suite.yaml` 必须通过 `compatibility.platformContractVersion` 声明正整数平台运行契约版本。主控只允许导入当前 Veydeck 支持的契约版本；当前支持值为 `1`。

主控解析归档后，以 `{ path, contentBase64 }` 结构向 Agent 传递包内文件。文本和二进制资产统一使用 Base64，Agent 解码为原始字节后落盘，禁止将 PNG、WebP 等二进制文件按 UTF-8 字符串处理。

套件交付仓库使用 `suites/<suiteId>/` 组织交付文件。分类不体现在目录中，必须以 `suite.yaml` 的 `metadata.category` 为准；版本不体现在目录中，必须以 `suite.yaml` 的 `metadata.version` 和发布 tag 为准。导入套件中心的 `.vsp` 根目录应是目标套件目录内容：

```text
suites/veydeck.example-app/
├── suite.yaml
├── compose.yaml
├── .env.example
├── README.md
├── CHANGELOG.md
└── assets/
    └── suite-icon.png
```

必需文件：

| 文件 | 用途 |
| --- | --- |
| `suite.yaml` | 套件清单，描述套件 ID、版本、Compose 文件、配置项、应用入口和权限声明。 |
| `compose.yaml` | Docker Compose 定义。 |
| `.env.example` | 安装时可配置变量模板；无变量套件可省略或只写说明注释。 |

可选文件：

| 文件 | 用途 |
| --- | --- |
| `README.md` | 用户可读说明。 |
| `assets/suite-icon.png` | 套件中心和应用库默认图标；套件必须使用至少 128×128 的正方形 PNG，推荐 256×256 透明 PNG。 |
| `CHANGELOG.md` | 版本更新说明。 |

## 7. 生命周期

套件实例生命周期如下：

```text
可安装 -> 已安装 -> 已启用 -> 已停用 -> 已卸载
              |          |
              v          v
             异常       异常
```

状态定义：

| 状态 | 含义 |
| --- | --- |
| `available` | 套件存在于目录或导入包中，但尚未安装到节点。 |
| `installing` | 正在校验套件、写入文件、准备环境或拉取镜像。 |
| `installed` | 套件文件和实例记录已创建，但 Compose 项目未启动。 |
| `enabling` | 正在执行 `docker compose up -d`。 |
| `enabled` | Compose 项目处于运行状态，应用入口可用。 |
| `disabling` | 正在执行停止操作。 |
| `disabled` | Compose 项目已停止，实例和数据仍保留。 |
| `error` | 生命周期操作失败，需要用户查看日志或重试。 |
| `uninstalled` | 实例记录和套件文件已删除；是否删除数据卷由卸载策略决定。 |

安装、启用和停用语义必须分开：

1. 安装：使用导入时已经完成 `metadata.minVeydeckVersion`、`compatibility.platformContractVersion`、`suite.yaml` 和 `compose.yaml` 校验的目录快照；将平台运行契约版本固化到实例，解析 Compose 镜像和可选的 `runtime.images`，本地已有镜像直接复用，缺失镜像必须拉取成功后才写入目标节点套件目录并启动 Compose。任一镜像准备失败时安装失败并回滚文件和登记。
2. 启用：执行 Compose 启动，健康检查通过后注册或激活应用入口。
3. 停用：停止 Compose 项目，但保留配置、数据库记录和数据卷。
4. 卸载：停止并删除 Compose 项目，删除套件文件和实例记录；数据卷默认保留，用户显式确认后才删除。

## 8. 应用库集成

应用库需要支持来源标记：

| 字段 | 说明 |
| --- | --- |
| `source_type` | `builtin` 表示内置应用，`suite` 表示套件应用。 |
| `suite_instance_id` | 套件应用关联的安装实例。 |
| `app_entry_id` | 套件清单中声明的入口 ID。 |
| `enabled` | 是否在应用库可见。 |

展示规则：

1. 应用库按“内置应用”和“套件应用”两组展示。
2. 套件中心本身是内置应用，固定出现在“内置应用”组。
3. 套件启用成功后，其声明的应用入口出现在“套件应用”组。
4. 用户打开套件应用时，仍走现有应用打开流程；区别只在入口类型和目标地址解析。

套件应用入口类型建议：

| 类型 | 说明 |
| --- | --- |
| `proxied_web` | 通过主控代理访问套件内 Web 服务。 |
| `external_url` | 打开套件声明的外部地址，仅用于明确可信场景。 |
| `compose_detail` | 打开 Docker Compose 项目详情页，用于无独立 UI 的基础设施套件。 |

v1 优先支持 `proxied_web` 和 `compose_detail`。

## 9. 访问代理

套件 Web 服务不应要求用户直接访问 Agent 地址。推荐由主控统一暴露代理入口：

```text
/api/v1/suite-instances/{instance_id}/proxy/{entry_id}/...
```

代理流程：

1. 用户点击应用库中的套件应用。
2. 前端根据应用入口打开窗口。
3. 主控校验会话和套件实例权限。
4. 主控转发请求到目标 Agent。
5. Agent 将请求转发到 Compose 服务容器的内部端口，或返回主控可连接的本地服务地址。

初期如果代理实现成本过高，可以先支持 `compose_detail` 和受控的本机端口跳转，但产品目标应收敛到统一代理入口，避免把节点网络细节暴露给用户。

## 10. 套件专用网络

每个运行套件的节点必须由 Agent 创建并维护一个统一的 Docker 专用网络：

```text
veydeck-suite-network
```

网络定位：

1. `veydeck-suite-network` 是 Veydeck 套件运行的标准网络边界。
2. 所有套件服务默认接入该网络，便于主控代理、Agent 探测和后续服务发现。
3. 套件不得各自创建不可控的默认业务网络作为唯一入口网络。
4. 普通 Docker Compose 项目不强制接入该网络；该规则只约束套件中心安装的 Compose 套件。

Agent 职责：

1. 安装或启用套件前检查 `veydeck-suite-network` 是否存在。
2. 不存在时执行等价于 `docker network create veydeck-suite-network` 的创建动作。
3. 网络已存在时复用，不修改用户已有配置。
4. 网络创建和失败原因写入 Agent 日志与主控审计日志。

套件 Compose 文件应把该网络声明为外部网络：

```yaml
networks:
  veydeck-suite-network:
    external: true
    name: veydeck-suite-network
```

服务接入示例：

```yaml
services:
  web:
    networks:
      - veydeck-suite-network

networks:
  veydeck-suite-network:
    external: true
    name: veydeck-suite-network
```

安全约束：

1. `veydeck-suite-network` 不等于无边界互信网络，套件仍必须遵守权限声明和代理访问控制。
2. 套件间默认不承诺稳定服务名互访，跨套件依赖后续通过显式依赖声明设计。
3. 需要隔离数据库、缓存等内部服务时，套件可以额外创建内部网络，但对外入口服务必须接入 `veydeck-suite-network`。
4. 禁止用 `network_mode: host` 替代 `veydeck-suite-network`，除非套件清单显式声明并通过高风险确认。

## 11. 数据模型

主控侧建议新增表：

### 11.1 `suite_catalog_items`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键。 |
| `suite_id` | 全局套件 ID。 |
| `name` | 展示名称。 |
| `version` | 当前目录版本。 |
| `summary` | 简短说明。 |
| `source` | `builtin_catalog`、`local_import` 或 `remote_catalog`。 |
| `manifest_json` | 解析后的 `suite.yaml`。 |
| `package_path` | 本地包路径或缓存路径。 |
| `checksum` | 套件包摘要。 |
| `created_at` / `updated_at` | 时间戳。 |

### 11.2 `suite_instances`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键。 |
| `suite_id` | 套件 ID。 |
| `version` | 已安装版本。 |
| `platform_contract_version` | 安装时固化的平台运行契约版本。 |
| `node_id` | 目标节点，本地节点固定为 `local`。 |
| `compose_project_name` | Agent 上的 Compose 项目名。 |
| `status` | 生命周期状态。 |
| `enabled` | 是否启用。 |
| `install_config_json` | 安装时用户填写的配置。 |
| `manifest_json` | 安装时锁定的清单内容。 |
| `last_error` | 最近一次失败原因。 |
| `installed_at` / `updated_at` | 时间戳。 |

### 11.3 `suite_app_entries`

| 字段 | 说明 |
| --- | --- |
| `id` | 主键。 |
| `suite_instance_id` | 套件实例 ID。 |
| `entry_id` | 清单中的入口 ID。 |
| `title` | 应用库展示名称。 |
| `icon` | 套件包 `assets/` 下的图标路径，安装后解析为主控资产 URL。 |
| `entry_type` | `proxied_web`、`external_url` 或 `compose_detail`。 |
| `target_json` | 入口目标配置。 |
| `enabled` | 是否在应用库显示。 |

Agent 侧通过 Compose 项目来源字段区分普通 Compose 项目和套件实例，保证套件生命周期只由套件中心管理。

## 12. API

控制面 API 遵循当前项目路由风格：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/suites/list?nodeId={node_id}` | 获取套件目录与目标节点安装摘要。 |
| `POST` | `/api/v1/suites/import` | 导入本地套件包。 |
| `POST` | `/api/v1/suites/{suite_id}/install` | 安装套件到指定节点。 |
| `GET` | `/api/v1/suite-install-tasks/{task_id}/progress` | 查询安装进度。 |
| `POST` | `/api/v1/suite-install-tasks/{task_id}/cancel` | 取消安装任务。 |
| `POST` | `/api/v1/suite-instances/{instance_id}/enable` | 启用套件实例。 |
| `POST` | `/api/v1/suite-instances/{instance_id}/disable` | 停用套件实例。 |
| `POST` | `/api/v1/suite-instances/{instance_id}/uninstall` | 卸载套件实例。 |
| `ANY` | `/api/v1/suite-instances/{instance_id}/proxy/{entry_id}/{path}` | 代理套件入口请求。 |

主控到 Agent 的内部操作可以基于现有 Docker Compose API 扩展，建议保持语义清晰：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/agent/docker/compose/suites/install` | 写入套件 Compose 项目。 |
| `POST` | `/api/v1/agent/docker/compose/suites/{project}/enable` | 执行 `up -d`。 |
| `POST` | `/api/v1/agent/docker/compose/suites/{project}/disable` | 执行 `stop`。 |
| `DELETE` | `/api/v1/agent/docker/compose/suites/{project}` | 删除套件 Compose 项目。 |

## 13. 安全约束

套件中心会把第三方 Compose 能力带入系统，必须从 v1 就定义安全边界。

默认禁止或强提醒的 Compose 配置：

| 配置 | 策略 |
| --- | --- |
| `privileged: true` | 默认禁止。 |
| `/var/run/docker.sock` 挂载 | 默认禁止。 |
| `network_mode: host` | 默认禁止，特殊套件需显式声明并二次确认。 |
| `pid: host` / `ipc: host` | 默认禁止。 |
| `devices` | 默认禁止，硬件类套件后续单独设计。 |
| 任意宿主机路径挂载 | 默认禁止，只允许声明后的白名单路径。 |
| `cap_add` | 默认禁止或要求精确声明。 |
| `latest` 镜像标签 | 不推荐，目录套件应固定版本。 |

校验流程：

1. 主控解析 `suite.yaml`，检查套件 ID、版本、平台运行契约版本、入口声明和权限声明。
2. Agent 执行 `docker compose -f - config` 校验 Compose 语法。
3. 主控或 Agent 对 Compose AST 做安全策略检查。
4. 安装前展示套件权限摘要，由用户确认高风险能力。
5. 所有安装、启用、停用和卸载操作写入审计日志。

### 13.1 Suite Runtime 安全边界

`runtime.agent.services` 是运行描述注入白名单，`runtime.agent.capabilities` 是 API 能力白名单，二者都必须在导入时校验。Agent 只向清单声明的服务注入实例级连接信息和令牌，并从令牌恢复 `suiteId`、`instanceId` 与节点身份。

`runtime.images` 同时承担额外镜像预拉取清单和动态 workload 镜像白名单。Agent 创建 workload 时必须精确匹配该列表；Compose 文件中出现过某镜像不代表套件后端可以再次动态启动它。

Suite Runtime 资源归属于套件实例。停用和卸载流程必须先结束该实例的活动 capture，再删除 workload，最后停止 Compose 项目，避免抓包槽、端口占用或业务容器遗留。

## 14. 文件与目录

Agent 侧 Compose 目录统一位于 `{VEYDECK_HOME}/data/compose`：

```text
{VEYDECK_HOME}/data/compose/
├── docker/
│   └── {docker_project_name}/
│       └── compose.yaml
└── suite/
    └── {compose_project_name}/
        ├── compose.yaml
        ├── .env
        ├── suite.yaml
        └── assets/
```

约束：

1. v1 套件为单例，`compose_project_name` 由 `suite_id` 稳定生成，不包含实例 UUID，例如 `veydeck.host-scanner` 对应 `veydeck-host-scanner`。
2. `instance_id` 只作为主控数据库主键和外部 API 标识，不参与 Compose 项目名、容器名或目录名。
3. 普通 Compose 项目和套件项目统一使用 `compose.yaml`，不得生成或保留 `docker-compose.yml` 副本。
4. 稳定项目名或目标目录已被占用时必须终止安装，不得覆盖普通 Compose 项目或遗留目录。
5. 套件包内路径不得通过 `..` 逃逸安装目录。
6. `.env` 由安装配置生成，不直接使用包内敏感值。
7. 卸载默认不删除 Docker named volume，除非用户明确选择“同时删除数据”。

## 15. v1 实施顺序

1. 定义 `suite.yaml` 最小 schema 和安全校验规则。
2. 新增套件目录与套件实例表。
3. 在套件中心实现本地导入、安装、启用、停用、卸载。
4. 复用 Agent 现有 Compose 创建、启停、删除和日志能力。
5. 应用库增加来源标记，按“内置应用”和“套件应用”分组。
6. 支持 `compose_detail` 入口，先让无 UI 套件可见可管。
7. 支持 `proxied_web` 入口，把套件 Web UI 接入现有窗口流程。
8. 增加 `minVeydeckVersion`、`platformContractVersion` 校验、Runtime 服务/能力/镜像授权摘要和审计日志。

## 16. 验收标准

1. 用户可以导入一个包含 `suite.yaml` 和 `compose.yaml` 的套件包。
2. 安装后 Agent 侧生成独立 Compose 项目目录和数据库记录。
3. 启用后容器启动，应用库出现套件应用入口。
4. 点击套件应用可以打开对应入口或 Compose 项目详情。
5. 停用后容器停止，应用库入口不可用或显示停用状态。
6. 卸载后套件实例消失，普通 Docker Compose 项目不受影响。
7. 高风险 Compose 配置会被阻断或要求明确确认。
8. 不满足 `minVeydeckVersion` 的套件包不能导入目录。
9. Suite Runtime 只能操作所属实例的 workload 和 capture，未声明能力或镜像时请求被拒绝。
10. 缺少平台运行契约版本、值不是正整数或当前平台不支持时，套件包不能导入。
