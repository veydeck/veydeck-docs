# Veydeck 协议仿真套件设计规范

本文档定义 `veydeck.protocol-simulation` Compose 套件的当前实现。协议仿真的 UI、业务 API、规则、实例状态、审计事件和 PCAP 文件均由套件维护；Veydeck 平台只提供套件生命周期、入口代理、Agent Runtime 能力和统一操作日志。

## 1. 运行边界

| 边界 | 职责 |
| --- | --- |
| `veydeck` | 导入、安装、启停和卸载套件；代理 Web 入口；向套件后端注入实例级 Agent Runtime。 |
| `veydeck-suites` | 保存 `suite.yaml`、Compose 交付文件、固定镜像引用和套件变更记录。 |
| `protocol-simulation` API/UI | 管理规则、实例、审计日志与 PCAP；调用 Agent suite-runtime API。 |
| `protocol-simulation-engine` | 在独立 workload 容器内运行具体协议仿真，并向套件 API 上报结构化事件。 |
| `veydeck-agent` | 创建和清理受控 workload、发布命名端点、执行整工作负载 PCAP 取证。 |
| `veydeck-sim-rules` | 维护 YAML 规则、审计规则内容并生成签名 `.vprp` 规则包。 |

主控不解析规则包，不保存仿真规则、交互审计或 PCAP，也不保留 `/api/v1/simulation/*`、`sim_*` 表或 Agent 内置协议运行器。

## 2. 镜像与交付

| 镜像 | 源码 | 用途 |
| --- | --- | --- |
| `veydeck/veydeck-protocol-simulation:<version>` | `crates/protocol-simulation` | 套件 API 与前端静态资源。 |
| `veydeck/veydeck-protocol-simulation-engine:<version>` | `crates/protocol-simulation-engine` | Agent 按规则创建的 workload。 |

engine 镜像不是 Compose 常驻服务，必须列入 `suite.yaml.runtime.images`。Agent 只允许套件启动清单声明的额外镜像。套件版本、两个镜像版本和规则包版本相互独立。

协议仿真套件清单通过 `compatibility.platformContractVersion: 1` 声明所需平台运行契约。主控在导入时校验该值，并在安装时将其固化到套件实例，供 Veydeck 升级兼容性检查使用。

## 3. v1 协议能力目录

API 与 engine 通过 common crate 共享 `ProtocolId`、行为配置、端点描述、启动配置和运行时事件。`GET /api/capabilities` 返回 `schemaVersion: 1`、协议描述及以下特性：

- `multiEndpoint`
- `wholeWorkloadCapture`
- `guidedRuleEditor`
- `advancedJsonEditor`

当前能力目录包含 19 种协议：

| 协议 | 容器端点 | 主要行为配置 |
| --- | --- | --- |
| HTTP | `main` · 80/TCP | Server Header、响应头、HTML、触发路由。 |
| Redis | `main` · 6379/TCP | Banner、认证、键值与命令响应。 |
| SMTP | `main` · 25/TCP | Banner、主机名、凭据、收件人与命令响应。 |
| POP3 | `main` · 110/TCP | Banner、凭据、消息与命令响应。 |
| IMAP | `main` · 143/TCP | Banner、凭据、邮箱、消息与命令响应。 |
| SSH | `main` · 22/TCP | Banner 与凭据。 |
| FTP | `main` · 21/TCP | Banner、服务器名、匿名登录与凭据。 |
| RDP | `main` · 3389/TCP | 协商 flags 与凭据。 |
| Telnet | `main` · 23/TCP | Banner、提示符、凭据与命令响应。 |
| MySQL | `main` · 3306/TCP | 服务版本、凭据、数据库与查询响应。 |
| PostgreSQL | `main` · 5432/TCP | 服务版本、凭据、数据库与查询响应。 |
| SMB | `main` · 445/TCP | 服务器名、域与共享列表。 |
| LDAP | `main` · 389/TCP | Base DN、凭据与目录条目。 |
| DNS | `dns-tcp` · 53/TCP；`dns-udp` · 53/UDP | A 记录、默认 IPv4 与 TTL。 |
| MongoDB | `main` · 27017/TCP | 服务版本、主机名与最大 Wire 版本。 |
| Memcached | `main` · 11211/TCP | 服务版本与统计项。 |
| SNMP | `main` · 161/UDP | Community、系统信息与 OID。 |
| MQTT | `main` · 1883/TCP | 匿名连接策略。 |
| VNC | `main` · 5900/TCP | RFB 协议版本与安全类型。 |

MongoDB、Memcached、SNMP、MQTT 和 VNC 面向服务发现与版本探测：MongoDB 响应握手、构建信息和服务状态命令；Memcached 响应版本与统计命令；SNMP 响应 v1/v2c GET、GETNEXT 和 GETBULK；MQTT 完成 CONNECT/CONNACK 与心跳；VNC 完成 RFB 版本和安全类型协商。它们不提供数据库查询、缓存存储、SNMPv3、消息路由或远程桌面 framebuffer。

DNS 是当前真实多端点规则。部署 UI 只要求用户输入一个主机端口，默认值为 `1053`；套件 API 在内部生成 `dns-tcp` 和 `dns-udp` 两条相同主机端口的绑定。TCP 与 UDP 可以合法共用同一数值端口。

## 4. 数据模型

套件私有 SQLite 位于套件数据卷，主要表如下：

| 表 | 说明 |
| --- | --- |
| `rules` | 导入规则和界面创建的自定义规则。 |
| `rule_packages` | 当前规则包的 manifest 摘要。 |
| `instances` | 实例、workload、状态和 PCAP 状态。 |
| `instance_endpoints` | 实例的命名端点、transport、主机端口和容器端口。 |
| `audit_logs` | engine 上报的结构化交互事件。 |

端口占用以 `(transport, host_port)` 判断；活动状态为 `deploying` 或 `running` 的实例保留端口。TCP 与 UDP 的同数值端口不冲突。

审计事件按实例保存，`event_id` 幂等。默认每个实例保留最新 10,000 条，可通过 `VEYDECK_SIM_AUDIT_MAX_PER_INSTANCE` 提高但不能降低基线。实例删除时级联删除端点与审计事件。

## 5. 套件 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查。 |
| `GET` | `/api/capabilities` | 查询 v1 协议与端点能力目录。 |
| `GET/POST` | `/api/rules` | 查询或创建规则。 |
| `DELETE` | `/api/rules/{id}` | 删除自定义规则。 |
| `GET` | `/api/rule-package/current` | 查询当前规则包。 |
| `POST` | `/api/rule-package/import` | 导入并验签 `.vprp`。 |
| `GET` | `/api/instances` | 查询实例并与 Agent workload 状态校准。 |
| `POST` | `/api/instances/deploy` | 按规则与命名端点绑定部署实例。 |
| `POST` | `/api/instances/{id}/undeploy` | 下线并删除 workload。 |
| `POST` | `/api/instances/{id}/pcap/start` | 开启整实例 PCAP。 |
| `POST` | `/api/instances/{id}/pcap/stop` | 停止并保存 PCAP。 |
| `DELETE` | `/api/instances/{id}/pcap` | 删除 PCAP 或停止活动取证。 |
| `POST` | `/api/instances/{id}/pcap/download` | 下载当前实例 PCAP。 |
| `GET` | `/api/instances/{id}/audit-logs` | 分页查询实例审计。 |
| `POST` | `/internal/events` | engine 上报结构化事件。 |

部署请求使用内部端点绑定：

```json
{
  "ruleId": "sim-rule-507001",
  "endpointBindings": [
    { "endpointId": "dns-tcp", "hostPort": 1053 },
    { "endpointId": "dns-udp", "hostPort": 1053 }
  ]
}
```

API 必须拒绝未知、重复、缺失的必需端点以及无效端口。前端可以把同一业务服务的多个 transport 合并为一个输入，但不能删减提交给 API 的端点集合。

## 6. Workload 编排

套件后端不挂载 Docker Socket。它读取 `/run/veydeck-agent/runtime.json`，通过 Runtime SDK 使用 `workloads.manage` 和 `captures.manage`：

```text
POST   /api/v1/agent/suite-runtime/workloads
GET    /api/v1/agent/suite-runtime/workloads
GET    /api/v1/agent/suite-runtime/workloads/{workload_id}
DELETE /api/v1/agent/suite-runtime/workloads/{workload_id}
POST   /api/v1/agent/suite-runtime/workloads/{workload_id}/captures
POST   /api/v1/agent/suite-runtime/workloads/{workload_id}/captures/{capture_id}/finish
```

每个 `WorkloadPort` 包含 `endpointId`、`hostPort`、`containerPort` 和 `protocol`。Agent 校验端点 ID、transport/port 唯一性、宿主机端口占用和镜像白名单，然后创建带所有端点发布规则的容器。

Agent 为 workload 保存实例所有权和端点 labels。停用或卸载套件前，Agent 按 `suite_instance_id` 停止取证并删除孤立 workload。

## 7. Engine 启动与事件

Agent 将 `configJson` 注入 workload 的 `VEYDECK_WORKLOAD_CONFIG_JSON`。当前启动配置的 `schemaVersion` 为 `1`：

```json
{
  "schemaVersion": 1,
  "protocol": "dns",
  "ruleId": "sim-rule-507001",
  "ruleName": "DNS 诱捕解析服务",
  "instanceId": "sim-...",
  "callbackUrl": "http://veydeck-protocol-simulation:8080/internal/events",
  "callbackToken": "...",
  "endpoints": [
    { "endpointId": "dns-tcp", "transport": "tcp", "hostPort": 1053, "containerPort": 53 },
    { "endpointId": "dns-udp", "transport": "udp", "hostPort": 1053, "containerPort": 53 }
  ],
  "behavior": {}
}
```

engine 按协议描述校验端点 ID、transport 和容器端口，再分别绑定 TCP listener 或 UDP socket。同一容器端口可同时绑定 TCP 与 UDP。DNS 使用 53/TCP 与 53/UDP 双端点，其中 TCP 报文带两字节长度前缀；SNMP 使用单个 161/UDP 端点。

运行时事件的 `schemaVersion` 为 `1`，包含 UUIDv7 `eventId`、`instanceId`、`endpointId`、事件类型、摘要、客户端地址、metadata、可选 payloadHex 和时间戳。套件 API 校验事件所属实例和端点后通过有界队列批量写入 SQLite。

## 8. 规则包与版本

规则包的归档、Protobuf、签名和版本策略见 [Veydeck 协议仿真规则包设计规范](./Veydeck协议仿真规则包设计规范.md) 与 [协议仿真套件与规则库兼容性契约](./Veydeck协议仿真套件与规则库兼容性契约.md)。

## 9. PCAP 与操作日志

PCAP 是工作负载级能力，一次抓包覆盖实例的全部公开端点。详细流程见 [Veydeck 协议仿真 PCAP 取证设计规范](./Veydeck交互式PCAP流量取证设计规范.md)。

规则创建/删除/导入、实例部署/下线、抓包生命周期和 PCAP 下载属于语义操作，套件后端通过 `operation-logs.write` 写入平台操作日志。查询、进度、内部 engine 事件和高频交互审计不进入平台操作日志。

## 10. 前端约束

- 前端通过 capability descriptors 渲染协议字段和规则详情，不得为非 HTTP 协议回退显示 HTTP Server Header 或 HTML。
- DNS 规则编辑支持 A 记录、默认 IPv4 和 TTL；详情以结构化表格展示记录。
- MongoDB、Memcached、SNMP、MQTT 和 VNC 规则编辑提供影响服务识别的最小行为字段，Memcached 统计项和 SNMP OID 在详情中以结构化表格展示。
- 部署弹窗保持单端口输入，DNS 内部展开为 TCP/UDP 同端口绑定。
- 实例列表按主机端口聚合 transport，例如 `1053/TCP/UDP`，不展示内部端点 ID。
- 审计从实例操作入口打开，只查询当前实例；实例下线后关联审计销毁。
- HTML 预览使用套件内受限 iframe，不依赖主控内置浏览器应用。
