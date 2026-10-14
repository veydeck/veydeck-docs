# 协议仿真套件与规则库兼容性契约

本文档定义 `veydeck-suite-protocol-simulation` 与 `veydeck-sim-rules` 的 v1 兼容边界。规则包由套件 API 解析；Veydeck 主控只提供套件生命周期与平台版本，不解析规则业务内容。

## 1. 双端源码一致性

| 端 | 位置 | 必须一致的结构 |
| --- | --- | --- |
| 套件 API | `crates/protocol-simulation/src/rule_package.rs` | `RuleEndpointProto`、`SimRuleProto`、`RulePackageManifestProto`、`SimRulePackageProto`。 |
| 规则库 | `veydeck-sim-rules/src/lib.rs` | 同名 Protobuf 结构。 |

字段 tag、类型、optional/repeated 属性和语义必须逐字段一致。任何一端修改后必须同步更新另一端及契约测试。

## 2. 端点契约

规则包中每条规则必须显式携带命名端点。套件 API 以 common crate 的 `ProtocolDescriptor` 为权威来源，逐项校验：

- 端点数量和 ID。
- `tcp` 或 `udp` transport。
- 固定容器端口。
- 默认主机端口范围。
- `required` 属性。

DNS 必须同时声明 `dns-tcp` 53/TCP 与 `dns-udp` 53/UDP，默认主机端口均为 1053。SNMP 声明 `main` 161/UDP，其他当前协议声明各自标准容器端口的 `main` TCP 端点。

前端可以把多个同业务端点简化为一个主机端口输入，但提交给套件 API 和 Agent 的端点集合必须完整。TCP 与 UDP 的同数值主机端口是两个不同绑定。

## 3. 行为契约

common crate 统一定义协议枚举、行为配置和字段描述。规则库的 `config_json`、套件 API 自定义规则和 engine 反序列化必须使用相同字段语义及 snake_case 序列化。

新增协议或字段时必须同步：

1. common 能力描述与行为类型。
2. engine 运行器与 transport 支持。
3. 套件 API 导入、创建和部署校验。
4. 规则库 YAML 审计、ID 分区和端点生成。
5. 前端编辑、详情和本地化。

任何环节遇到未知协议、未知端点或无法按目标协议归一化的行为时，应拒绝规则或部署，不得静默回退为 HTTP。

## 4. 签名契约

`rules.bin.sig` 必须真实覆盖归档中的原始 `rules.bin`。套件 API 使用可信 Ed25519/minisign 公钥验签后才能解码和写库。

签名缺失、编码非法、验签失败、payload 被修改或归档包含未知条目时，必须拒绝整个导入事务。不得把“签名文件存在”视为验签成功。

## 5. 版本声明

规则包 manifest 的 `min_veydeck_version` 表示所需最低平台能力。套件 API 从实例隔离的 Agent Runtime 描述读取 `platformVersion` 并执行 SemVer 比较。

套件自身的 `suite.yaml.metadata.minVeydeckVersion` 由主控在套件包导入时校验。两个最低版本声明用途不同，不能相互替代。

`suite.yaml.compatibility.platformContractVersion` 表示协议仿真套件依赖的平台运行契约，当前值为 `1`。它由主控校验并固化到套件实例，供 Veydeck 平台升级检查使用，不属于规则包 manifest、engine 启动配置或 Runtime 描述。

规则包版本、套件版本、API/UI 镜像版本和 engine 镜像版本独立。规则包 manifest 当前没有 `min_suite_version`，因此依赖特定套件能力时还必须在规则库 CHANGELOG 中明确说明。

## 6. 规则 ID 与替换

- 官方规则 ID 必须位于 `[1, 999_999]`，包内唯一且语义稳定。
- 套件导入后使用 `sim-rule-<id>`。
- `1_000_000+` 留给套件自定义规则。
- 导入新包时以事务替换旧包规则；失败必须完整回滚。
- 运行实例与 workload 生命周期独立于规则包刷新，不得因规则替换成为孤立资源。

## 7. 跨仓库变更顺序

涉及新协议、端点、字段或行为时，变更顺序为：

1. 平台与 Runtime 能力先满足新契约。
2. 发布支持新能力的协议仿真 API/UI 与 engine。
3. 更新 `veydeck-suites` 固定镜像和最低平台版本。
4. 最后发布使用新能力的规则包。

## 规则包归属

协议仿真规则包使用 `.vprp` 后缀（Veydeck Protocol Rule Package）。manifest 必须包含 `suite_id = "veydeck.protocol-simulation"`（Protobuf tag 8）和 `package_type = "protocol-simulation-rules"`（tag 9）。两字段随 `rules.bin` 一起签名；导入端拒绝缺失或不匹配的归属。
