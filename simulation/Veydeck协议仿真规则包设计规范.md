# Veydeck 协议仿真规则包设计规范

本文档定义协议仿真规则包 `.vprp` 的 v1 交付格式、生成、验签、导入和版本边界。规则包由协议仿真套件 API 消费，是套件业务资产，不属于 Veydeck 主控数据库资产。

## 1. 职责边界

| 仓库或组件 | 职责 |
| --- | --- |
| `veydeck-sim-rules` | 维护 YAML、执行静态审计、生成 Protobuf、签名并打包。 |
| `veydeck-suite-protocol-simulation` | 验签、解析、校验并事务写入套件私有 SQLite。 |
| `veydeck-suites` | 保存套件交付清单和固定 API/UI、engine 镜像引用。 |
| `veydeck` | 校验套件最低平台版本并提供 Runtime `platformVersion`，不解析规则包。 |

## 2. 规则源文件

规则使用 YAML 保存，核心字段包括数字 ID、中英文名称与描述、分类、协议、默认主机端口、规则版本、引用、标签和 `configYaml` 行为。

规则库静态审计至少检查：

1. 必填字段、分类、severity、HTTPS 引用和规则 ID 唯一性。
2. 协议 ID 分区及目录布局。
3. 协议行为 schema 和必需字段。
4. 可执行载荷、私钥等危险或敏感内容。
5. 默认端口范围和受支持协议集合。

官方规则 ID 使用 `[1, 999_999]`，`1_000_000+` 留给套件内自定义规则。导入后官方 ID 转换为 `sim-rule-<id>`。

新增服务发现协议使用独立的 10,000 ID 分区：MongoDB `330000–339999`、Memcached `340000–349999`、SNMP `510000–519999`、MQTT `520000–529999`、VNC `640000–649999`。首条 honeypot 规则分别使用 `337001`、`347001`、`517001`、`527001` 和 `647001`。

## 3. 归档格式

规则库包使用 `.vprp` 后缀，文件名为 `veydeck-sim-rules-<version>.vprp`。`.vprp` 内部仍是 gzip 压缩的 tar 归档；包归属由 `rules.bin` 中的 `RulePackageManifestProto.suite_id` 声明为 `veydeck.protocol-simulation`，`package_type` 声明为 `protocol-simulation-rules`。这两个字段属于签名载荷，导入端必须同时校验，不能仅凭后缀判断包类型。归档根目录只允许：

```text
rules.bin
rules.bin.sig
```

规则库打包器将产物写入：

```text
dist/veydeck-sim-rules-<version>.vprp
```

套件 API 对上传体、`rules.bin`、签名和规则数量设置上限；拒绝重复、未知、目录型或非 UTF-8 归档项，防止归档穿越和资源耗尽。

## 4. Protobuf v1 契约

```protobuf
syntax = "proto3";

message RuleEndpointProto {
    string id = 1;
    string transport = 2;
    int32 container_port = 3;
    int32 default_host_port = 4;
    bool required = 5;
}

message SimRuleProto {
    int64 id = 1;
    string name = 2;
    string name_en = 3;
    optional string cve = 4;
    string category = 5;
    string description_zh = 6;
    string description_en = 7;
    string protocol = 8;
    optional int64 default_port = 9;
    string config_json = 10;
    repeated RuleEndpointProto endpoints = 11;
}

message RulePackageManifestProto {
    string package_id = 1;
    string version = 2;
    int32 ruleset_format_version = 3;
    string min_veydeck_version = 4;
    int64 generated_at = 5;
    int32 rule_count = 6;
    int32 schema_version = 7;
    string suite_id = 8; // 固定为 "veydeck.protocol-simulation"
    string package_type = 9; // 固定为 "protocol-simulation-rules"
}

message SimRulePackageProto {
    RulePackageManifestProto manifest = 1;
    repeated SimRuleProto rules = 2;
}
```

规则库与套件 API 必须保持 tag、类型和语义一致。当前 `schema_version` 和 `ruleset_format_version` 均为 `1`。归属字段为必填校验项。

## 5. 命名端点

打包器依据协议生成端点：

- 除 DNS 与 SNMP 外，当前协议生成一个 `main` TCP 端点；容器端口使用协议标准端口，默认主机端口使用规则 `defaultPort`。
- DNS 生成 `dns-tcp` 和 `dns-udp` 两个必需端点，容器端口均为 53，默认主机端口均为 1053。
- SNMP 生成一个 `main` UDP 端点，容器端口和默认主机端口均为 161。

套件导入端必须将每条规则的端点集合与 common crate 的协议描述逐项比对，包括 ID、transport、容器端口、required 和默认主机端口合法性。端点数量不符、缺失、未知 transport 或无效端口均拒绝整个规则包。

## 6. 签名

`rules.bin.sig` 是覆盖原始 `rules.bin` 字节的 Ed25519/minisign 分离签名。打包器支持未加密 Ed25519 私钥内存签名和加密 minisign 私钥 CLI 签名。

套件 API 从内置可信公钥或 `VEYDECK_SIM_RULES_PUBLIC_KEY` 读取公钥并执行真实验签。以下情况必须拒绝导入：

- 缺少签名或公钥。
- 签名编码、算法前缀或长度非法。
- 签名与 `rules.bin` 不匹配。
- 预哈希 minisign 签名验证失败。

仅检查签名文件存在不满足安全要求。

## 7. 导入校验与事务

套件 API 导入顺序：

1. 解析归档并取得唯一的 `rules.bin`、`rules.bin.sig`。
2. 使用可信公钥验证原始 payload。
3. 解码 Protobuf，校验 `package_id`、`suite_id`、`package_type`、两个 v1 版本字段、SemVer 和规则数量。
4. 检查规则 ID 范围与唯一性、协议、端点和行为 schema。
5. 将规则行为规范化，并包装中英文描述、分类和 CVE 元数据。
6. 在事务中替换旧包规则和 `rule_packages` 摘要。

运行中的实例可以继续引用已部署 workload；规则包刷新不得产生孤立 workload。导入失败必须回滚，不得留下部分新规则。

## 8. 导入 API 与摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/rule-package/import` | 以 `archive` 或 `file` 上传 `.vprp`。 |
| `GET` | `/api/rule-package/current` | 查询当前规则包摘要。 |

摘要示例：

```json
{
  "success": true,
  "data": {
    "packageId": "veydeck-sim-rules",
    "version": "0.1.0-alpha.1",
    "rulesetFormatVersion": 1,
    "minVeydeckVersion": "0.1.0-alpha.3",
    "ruleCount": 46,
    "generatedAt": "2026-08-11T00:00:00Z",
    "importedAt": "2026-08-11T00:00:00Z"
  }
}
```

示例版本和数量只说明响应结构，不构成固定库存承诺；实际值以包 manifest 为准。

## 9. 最低版本与独立版本

| 版本 | 来源 |
| --- | --- |
| 规则包版本 | `.vprp` manifest `version`。 |
| 规则格式版本 | `schema_version`、`ruleset_format_version`。 |
| 最低平台版本 | manifest `min_veydeck_version`。 |
| 套件版本 | `suite.yaml.metadata.version`。 |
| API/UI、engine 版本 | 各 crate `Cargo.toml`。 |

套件 API 从 Agent Runtime 描述读取 `platformVersion`，使用 SemVer 比较规则包 `min_veydeck_version`。平台版本不足时拒绝导入。

规则包、套件和两个镜像独立演进。规则使用新协议或新行为前，目标套件必须先具备对应 capability，再提供依赖该能力的规则包。
