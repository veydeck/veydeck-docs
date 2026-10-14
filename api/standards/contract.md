# Veydeck OpenAPI 契约规范

## 1. 格式

- 使用 OpenAPI `3.1.x` 和 YAML。
- 每个可独立部署的服务维护一份契约。
- `catalog.yaml` 是契约登记入口。
- OpenAPI 是接口事实来源；Markdown 不重复字段定义。

## 2. Operation 必填项

每个 operation 必须声明：

- `operationId`
- `tags`
- `summary`
- `responses`
- `security`
- `x-veydeck`

有请求体时声明 `requestBody`；有参数时声明 `parameters`。

## 3. 命名

- `operationId` 全组织唯一，格式为 `<project><domain><action>`。
- Schema 使用 `UpperCamelCase`。
- JSON 属性使用 `camelCase`。
- Tag 使用稳定领域名称，不使用页面标题。
- 公共 Schema 放入 `components` 并通过 `$ref` 复用。

## 4. Schema

- 必填字段必须进入 `required`。
- 可空字段使用 JSON Schema 联合类型：`type: [string, 'null']`。
- 枚举必须列出允许值。
- ID 不默认声明为 UUID；以实际格式为准。
- 日期时间使用 Unix 毫秒 `integer` 或明确的 `date-time`，同一领域保持一致。
- 敏感输入使用 `writeOnly: true`。
- 未核实结构不得虚构字段；可临时使用宽松 Schema，并在 `notes` 标记。

## 5. 响应

- 列出业务可能返回的主要 HTTP 状态。
- JSON 响应必须声明媒体类型和 Schema。
- 通用错误使用 `components.responses` 复用。
- 文件、流、SSE 和 WebSocket 使用对应媒体类型或握手状态，不套用普通 JSON Schema。

## 6. 安全

- 受保护接口声明具体 `security`。
- 公开接口显式声明 `security: []`。
- 安全方案统一定义在 `components.securitySchemes`。
- 示例不得包含真实密码、令牌、IP 或个人信息。

## 7. `x-veydeck`

```yaml
x-veydeck:
  owner: veydeck
  layer: control-plane
  lifecycle: active
  implementationStatus: unverified
  source:
    repository: veydeck
    file: crates/veydeck/src/api/example.rs
  designDocs: []
  reviewedAt: null
  notes: ''
```

字段规则：

- `layer`: `control-plane | agent | public | internal`
- `lifecycle`: `draft | active | deprecated | removed`
- `implementationStatus`: `unverified | verified | drifted | missing`
- `reviewedAt`: `YYYY-MM-DD`；未核对为 `null`
- `source` 必须指向仓库和实现文件
- `notes` 只记录偏移、缺项和待确认结论

## 8. 契约拆分

- 按部署服务拆分顶层文件。
- 领域过大时通过 `$ref` 拆分 `paths` 和 `schemas`。
- 禁止复制同名公共 Schema。
- 相对引用必须能在静态构建和校验脚本中解析。
