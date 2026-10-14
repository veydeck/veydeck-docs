# Veydeck 单用户认证与会话管理设计

本文档定义 Veydeck Web 控制台的用户认证、登录态、会话生命周期与前后端协作规则。Veydeck 当前定位为单用户安全实验平台，不设计多用户管理、RBAC 权限分配或组织租户模型。

---

## 1. 设计结论

- Web 控制台采用 **HttpOnly Cookie + 服务端 Session** 作为唯一登录态模型。
- JWT 不作为 Web 控制台主登录态使用。
- 前端不得通过 `localStorage`、`sessionStorage` 或内存 token 自行判断用户已登录。
- 后端数据库中的会话记录是登录态唯一事实来源。
- 删除数据库、删除管理员用户、修改密码、退出登录或撤销会话后，旧浏览器登录态必须立即失效。
- 控制面与 `veydeck-agent` 之间的分布式信任仍使用 mTLS、enrollment token 与 runtime session，不与 Web 控制台用户会话混用。

---

## 2. 适用边界

### 2.1 单用户约束

- 系统只允许一个内置管理员账号。
- `users` 表保留是为了保存管理员密码哈希、账号状态和审计关联，不代表支持多用户管理。
- 不提供用户列表、新增用户、角色分配、权限矩阵等管理能力。
- 后续如需多用户，应重新设计用户域、角色域、会话域和审计域，不在当前模型上临时扩展。

### 2.2 高权限控制台约束

Veydeck 控制台具备节点部署、终端、文件管理、仿真服务、容器管理等高权限能力，因此不能采用纯无状态登录态。认证系统必须支持：

- 服务端立即吊销会话。
- 用户不存在时拒绝旧会话。
- 密码变更后旧会话失效。
- 数据库重建后旧 Cookie 无法继续访问。
- 退出登录、浏览器刷新、后端重启后的状态一致。
- 任意业务接口返回 `401` 后前端回到登录页。

---

## 3. 数据模型

### 3.1 `users`

`users` 表只保存单个管理员账号。

建议字段：

| 字段                  | 说明                              |
| --------------------- | --------------------------------- | --------- |
| `id`                  | 管理员用户 ID                     |
| `username`            | 管理员用户名，默认 `admin`        |
| `password_hash`       | 使用 bcrypt/argon2 保存的密码哈希 |
| `status`              | `active                           | disabled` |
| `password_changed_at` | 最近一次密码变更时间              |
| `created_at`          | 创建时间                          |
| `updated_at`          | 更新时间                          |

约束：

- `users` 表最多只能有一个有效管理员。
- 管理员不存在时，所有受保护 API 必须返回 `401`。
- 管理员 `status != active` 时，所有受保护 API 必须拒绝访问。

### 3.2 `auth_sessions`

`auth_sessions` 保存 Web 控制台服务端会话。

建议字段：

| 字段                 | 说明                                                       |
| -------------------- | ---------------------------------------------------------- |
| `id`                 | 会话 ID                                                    |
| `session_token_hash` | 会话随机 token 的哈希值，数据库不得保存明文 token          |
| `user_id`            | 管理员用户 ID                                              |
| `created_at`         | 创建时间                                                   |
| `expires_at`         | 绝对过期时间                                               |
| `last_seen_at`       | 最近访问时间                                               |
| `revoked_at`         | 撤销时间，非空表示会话失效                                 |
| `revoked_reason`     | 撤销原因，例如 `logout`、`password_changed`、`admin_reset` |
| `client_ip`          | 登录来源 IP                                                |
| `user_agent`         | 登录来源 UA                                                |

约束：

- `session_token_hash` 必须唯一。
- 查询会话必须同时校验 `revoked_at IS NULL`、`expires_at > now`、管理员仍存在且状态正常。
- 修改管理员密码时必须撤销所有既有会话。
- 删除数据库后，`auth_sessions` 不存在，旧 Cookie 必须自然失效。

---

## 4. Cookie 规范

Web 控制台只依赖服务端写入的 Cookie。

| Cookie           | 说明                                 |
| ---------------- | ------------------------------------ |
| `veydeck_session` | 随机高熵会话 token，仅浏览器自动携带 |

属性要求：

- `HttpOnly`
- `SameSite=Lax`，如后续跨站部署再单独评估 `None + Secure`
- 生产环境必须启用 `Secure`
- `Path=/`
- `Max-Age` 不超过服务端会话过期时间

前端不得读取 `veydeck_session`，也不得把任何刷新凭据写入 `localStorage`。

---

## 5. API 设计

### 5.1 `POST /api/v1/auth/login`

请求：

```json
{
  "username": "admin",
  "password": "..."
}
```

处理流程：

1. 查询唯一管理员账号。
2. 校验账号存在、状态为 `active`。
3. 校验密码。
4. 生成高熵随机 session token。
5. 保存 `session_token_hash` 到 `auth_sessions`。
6. 写入 `veydeck_session` HttpOnly Cookie。
7. 返回当前会话摘要，不返回 access token 或 refresh token。

响应数据建议：

```json
{
  "user": {
    "id": 1,
    "username": "admin"
  },
  "session": {
    "expiresAt": 1782800000
  }
}
```

### 5.2 `GET /api/v1/auth/me`

用途：

- 前端启动时确认当前浏览器是否仍处于有效登录态。
- 路由守卫进入受保护页面前使用。

处理流程：

1. 从 `veydeck_session` Cookie 读取会话 token。
2. 哈希后查询 `auth_sessions`。
3. 校验会话未撤销、未过期。
4. 校验管理员仍存在且状态为 `active`。
5. 更新 `last_seen_at`。

无效时返回 `401`。

### 5.3 `POST /api/v1/auth/logout`

处理流程：

1. 读取当前 `veydeck_session`。
2. 找到会话则写入 `revoked_at` 与 `revoked_reason = logout`。
3. 清理浏览器 Cookie。
4. 即使会话不存在，也返回幂等成功并清 Cookie。

### 5.4 不提供 `/auth/refresh`

服务端 Session 模型不需要 refresh token。

- 不再向前端返回 `refreshToken`。
- 不再从 `localStorage` 读取刷新凭据。
- 控制面不提供 `/api/v1/auth/refresh` 路由。

---

## 6. 请求认证流程

所有受保护 API 使用统一认证提取器或中间件：

1. 从 Cookie 提取 `veydeck_session`。
2. 对 token 做哈希。
3. 查询 `auth_sessions`。
4. 校验会话状态与过期时间。
5. 查询并校验管理员用户。
6. 将 `AuthenticatedAdmin` 放入请求上下文。
7. 业务处理器只使用认证上下文，不再直接解析 JWT Claims。

失败语义：

| 场景         | HTTP 状态                              |
| ------------ | -------------------------------------- |
| 缺少 Cookie  | `401`                                  |
| 会话不存在   | `401`                                  |
| 会话过期     | `401`                                  |
| 会话已撤销   | `401`                                  |
| 管理员不存在 | `401`                                  |
| 管理员禁用   | `403` 或 `401`，当前阶段建议统一 `401` |

---

## 7. 前端协作规则

### 7.1 路由守卫

前端不得通过本地 token 判断登录态。

受保护路由进入前：

1. 调用 `GET /api/v1/auth/me`。
2. 成功则进入桌面。
3. `401` 则跳转 `/login`。

为避免每次路由都请求后端，可在当前页面生命周期内缓存 `me` 结果；但刷新页面后必须重新确认。

### 7.2 全局 401 处理

任意非登录接口返回 `401` 时：

1. 清理前端内存中的认证状态。
2. 关闭或冻结需要认证的轮询与 WebSocket。
3. 跳转 `/login`。
4. 不再尝试 refresh token。

### 7.3 登录页

- 登录页只提交用户名和密码。
- 登录成功后由 Cookie 自动承载会话。
- 前端不保存 access token、refresh token 或 session token。

---

## 8. 审计要求

认证系统必须写入平台日志：

- 登录成功。
- 登录失败。
- 会话校验失败，按频率采样或聚合，避免噪声过大。
- 退出登录。
- 会话过期清理。
- 密码修改导致会话撤销。

日志中不得记录明文密码、明文 session token 或 token hash。

---

## 9. 与 Agent 信任体系的关系

Web 控制台认证只解决“浏览器用户是否允许访问控制面 API”。

控制面与执行面仍采用独立机制：

- 节点首次纳管使用 enrollment token。
- 节点运行时使用 mTLS 与证书指纹绑定。
- 节点在线状态使用 `node_sessions` 租约。
- Web 用户会话不得透传给 `veydeck-agent`。

这两套会话不能混用：

- `auth_sessions` 是浏览器到 `veydeck` 的用户会话。
- `node_sessions` 是 `veydeck-agent` 到 `veydeck` 的运行时节点会话。

---
