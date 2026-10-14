# Veydeck API 设计规范

## 1. 基础

- HTTP API 前缀统一为 `/api/v1`。
- 使用 JSON；上传、下载和流式接口除外。
- 路径使用小写 `kebab-case`，字段使用 `camelCase`。
- ID、时间、枚举和布尔值保持明确类型，不使用含义不清的字符串。
- Master、Local Node、Node 为标准领域名称。

## 2. 路径

- 集合资源使用复数：`/nodes`、`/notifications`。
- 单资源 ID 紧跟资源名：`/node/{node_id}`。
- 全局节点管理遵循 `/nodes/{action}`。
- 单节点操作遵循 `/node/{node_id}/{action}`。
- Agent 本地入口使用 `/agent/**`。
- 指定 Node 的 Agent 入口使用 `/node/{node_id}/agent/**`。
- 路径表达资源和稳定业务动作，不包含 UI 页面名称。

## 3. HTTP 方法

| 方法 | 用途 |
| --- | --- |
| `GET` | 无副作用读取 |
| `POST` | 创建、执行动作、复杂查询 |
| `PUT` | 完整更新或幂等状态设置 |
| `PATCH` | 部分更新 |
| `DELETE` | 删除或清空 |

- 读取接口不得修改状态。
- 动作接口使用 `POST /resource/{id}/{action}`。
- 可重复执行且结果一致的状态设置优先使用 `PUT`。

## 4. 请求

- Path 参数使用 `snake_case`：`{node_id}`。
- Query 用于分页、筛选、排序和简单读取参数。
- JSON Body 用于创建、更新、复杂查询和动作参数。
- 分页字段统一为 `page`、`pageSize`。
- 时间统一使用 Unix 毫秒整数；字段以 `At` 结尾。
- 枚举值使用稳定英文标识；接口不得返回本地化枚举。
- 密码、令牌和密钥不得出现在 URL、日志或错误详情中。

## 5. 响应

普通 JSON 接口统一返回：

```json
{
  "success": true,
  "code": 200,
  "message": "operation completed",
  "messageKey": "operation.completed",
  "errorCode": null,
  "data": {}
}
```

- `success` 与 HTTP 状态一致。
- `code` 为 HTTP 状态码。
- `message` 使用稳定英文，不承担前端本地化。
- `messageKey` 为可选的前端 i18n key；无本地化需求时省略。
- `errorCode` 使用稳定业务错误码；成功时省略或为 `null`。
- `data` 保存业务数据或受控排障详情。
- `messageKey`、`errorCode`、`data` 无值时可以省略。
- 文件、流和 WebSocket 不使用 JSON 包装。

## 6. 状态码

| 状态码 | 含义 |
| --- | --- |
| `200` | 成功读取、更新或执行 |
| `201` | 资源创建成功 |
| `204` | 成功且无响应体 |
| `400` | 参数或业务状态无效 |
| `401` | 未认证或会话失效 |
| `403` | 已认证但无权访问 |
| `404` | 资源不存在 |
| `409` | 状态或资源冲突 |
| `422` | 结构合法但语义校验失败 |
| `500` | 服务内部错误 |
| `502` | 上游服务失败 |
| `504` | 上游服务超时 |

- 不把所有失败统一返回 `500`。
- 不向用户暴露数据库、解析器或系统命令原始错误。

## 7. 认证与通信

- Web Console 使用 `veydeck_session` HttpOnly Cookie。
- 公开接口必须在契约中显式声明 `security: []`。
- Master 是 Web Console 的唯一 API 入口。
- Master 与 Agent 使用 Unix Socket 或 HTTPS/mTLS。
- Agent 错误经 Master 转发时保留 HTTP 状态和业务错误码。

## 8. 幂等与并发

- `GET`、`PUT`、`DELETE` 应保持幂等。
- 创建接口需要防止重复资源时使用唯一约束或幂等键。
- 长耗时任务返回任务标识，不长期占用普通请求。
- 冲突更新返回 `409`，不得静默覆盖。

## 9. 文件与 WebSocket

- 上传使用 `multipart/form-data`，限制大小并校验类型。
- 下载设置正确的 `Content-Type` 和 `Content-Disposition`。
- WebSocket 握手入口纳入 OpenAPI，消息协议单独定义契约。
- WebSocket 消息必须包含稳定的类型字段和结构化 payload。
