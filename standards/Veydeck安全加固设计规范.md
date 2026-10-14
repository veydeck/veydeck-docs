# Veydeck 安全加固设计规范

本文档定义 Veydeck Web 控制台已实现的安全加固机制，包括安全入口、安装凭证初始化、密码规则、登录验证码、防爆破、系统配置存储、安全设置接口与 `slctl` 本地管理能力。

本文档只描述当前已落地能力。两步验证、通行密钥、API Token、授权 IP、域名绑定等字段已在数据库结构中预留，但当前阶段不提供对应业务功能。

---

## 1. 设计结论

- 生产安装环境通过安装流程生成初始账号、密码和安全入口，不创建固定 `admin/admin`。
- debug 开发模式允许在缺少 bootstrap 文件时自动创建 `admin/admin`，并关闭安全入口，方便本地直接启动。
- 安全入口只保护登录入口，不改变 API、静态资源和已认证会话接口路径。
- 浏览器通过正确安全入口访问后，服务端写入 `veydeck_safe_entry` Cookie，用于后续识别该浏览器已访问过当前环境的安全入口。
- 登录失败一次后，当前来源 IP 后续登录必须提交验证码。
- 验证码由服务端使用 `captcha-rs` 生成 4 位数字图片验证码，并一次性消费。
- 密码复杂度默认关闭；关闭时仍要求密码至少 5 位，开启后要求 8-30 位且至少包含两类字符。
- 前端修改用户名、修改密码只依赖已认证会话权限，不要求再次输入旧密码。
- `slctl` 必须由 root 用户执行，允许本地直接修改管理员用户名、密码和安全入口。
- `system_config` 使用单行宽表，`id` 固定为 `1`，通过数据库字段预留未来安全能力。

---

## 2. 安全入口

### 2.1 路径规则

安全入口是随机登录路径。默认登录地址为：

```text
https://127.0.0.1:7310/login
```

开启安全入口后，登录地址变为：

```text
https://127.0.0.1:7310/<safe_entry>
```

安全入口值规则：

- 长度为 8-32 个字符。
- 仅允许 ASCII 字母和数字。
- 自动生成长度为 16 个字符。
- 不允许使用保留路径前缀：`api`、`assets`、`images`、`favicon`、`static`、`public`、`health`、`metrics`、`ws`、`wss`、`robots`。
- 保留路径前缀按大小写不敏感的前缀匹配，例如 `api123456` 不允许作为安全入口。

### 2.2 请求行为

| 场景 | 行为 |
| --- | --- |
| 安全入口关闭，访问 `/` | 跳转 `/login` |
| 安全入口关闭，访问 `/login` | 显示登录页 |
| 安全入口开启，访问 `/<safe_entry>` | 写入安全入口 Cookie 并显示登录页 |
| 安全入口开启，访问 `/login` 且 Cookie 有效 | 显示登录页 |
| 安全入口开启，访问 `/login` 且 Cookie 无效 | 返回安全入口提示页 |
| 安全入口开启，访问 `/` 且 Cookie 有效 | 自动补全并跳转到当前安全入口 |
| 安全入口开启，访问 `/` 且 Cookie 无效 | 返回安全入口提示页 |
| 安全入口修改 | 新入口立即生效，旧入口失效 |
| 安全入口关闭 | 默认登录地址恢复为 `/login` |

安全入口提示页返回 `200`，不暴露安全入口值，只提示在服务器执行：

```bash
slctl info
```

### 2.3 Cookie

| Cookie | 说明 |
| --- | --- |
| `veydeck_safe_entry` | 当前浏览器已访问正确安全入口的记录 |

属性：

- 值为 `base64(<safe_entry>)`。
- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- 生产 HTTPS 环境启用 `Secure`
- 生命周期为 30 天

该 Cookie 不承载认证身份。服务端每次校验时都必须解码后与当前 `system_config.safe_entry` 完全一致。

---

## 3. 安装凭证初始化

安装脚本负责生成初始安全信息，并写入一次性 bootstrap 文件：

```text
${VEYDECK_CONFIG_DIR}/bootstrap-security.json
```

安装完成后展示当前登录地址、用户名和密码。中间 bootstrap 阶段不在日志中打印生成值。

生产安装环境必须使用 bootstrap 文件初始化。debug 开发模式在 `users` 为空且 bootstrap 文件不存在时，可以自动创建 `admin/admin` 并关闭安全入口；该行为不得出现在 release/生产构建中。

初始化流程：

1. `install.sh` 生成默认用户名、随机密码和随机安全入口。
2. 用户可在安装交互中覆盖用户名、密码和安全入口。
3. `install.sh` 写入 `bootstrap-security.json`，权限为 `0600`。
4. `veydeck` 启动并执行数据库迁移。
5. 用户服务消费 bootstrap 文件，写入管理员账号和系统安全配置。
6. bootstrap 文件消费成功后立即删除。

默认规则：

| 项 | 规则 |
| --- | --- |
| 默认用户名 | `veydeck` |
| 用户名格式 | 1-64 位，ASCII 字母、数字、下划线和连字符 |
| 随机密码 | 16 位，包含大小写字母、数字和指定特殊字符 |
| 安装密码校验 | 不做复杂度校验，但至少 5 位 |
| 安全入口 | 默认生成 16 位字母数字，安装后默认开启 |

`slctl` 不提供查看密码能力。安装完成后如果丢失初始密码，只能通过 `slctl passwd` 修改。

---

## 4. 密码规则

密码校验分为基础长度规则和可选复杂度规则。

| 场景 | 规则 |
| --- | --- |
| 密码为空 | 拒绝 |
| 密码复杂度关闭 | 至少 5 位 |
| 密码复杂度开启 | 8-30 位，且至少包含两类字符 |

复杂度字符类型：

- 字母：`A-Z`、`a-z`
- 数字：`0-9`
- 特殊字符：非 ASCII 字母数字字符

修改密码入口：

- 前端设置应用调用 `PUT /api/v1/security/password`。
- `slctl passwd` 直接操作本地数据库。
- 两者都不验证旧密码。
- 后端和 `slctl` 都执行相同语义的密码规则。

---

## 5. 登录验证码与防爆破

### 5.1 失败追踪

登录失败按来源 IP 追踪。

| 条件 | 行为 |
| --- | --- |
| 首次登录失败 | 记录失败次数 |
| 失败次数达到 1 次 | 后续登录要求验证码 |
| 失败次数达到 5 次 | 临时锁定登录 |
| 登录成功 | 清除当前 IP 的失败记录 |

默认锁定时长为 15 分钟。

### 5.2 验证码

验证码由服务端生成和校验：

- 使用 `captcha-rs`。
- 4 位数字。
- 图片宽高为 `160 x 60`。
- 服务端内存保存验证码答案。
- 有效期 5 分钟。
- 校验时一次性消费，成功或失败后该验证码 ID 都不能重复使用。

### 5.3 登录接口协作

前端在登录页加载时调用：

```text
GET /api/v1/auth/captcha-status
```

如果返回需要验证码，则加载：

```text
GET /api/v1/captcha
```

登录请求：

```json
{
  "username": "veydeck",
  "password": "...",
  "captcha_id": "uuid-string",
  "captcha": "4937"
}
```

验证码只有在当前 IP 已触发验证码要求时必填。

---

## 6. 数据模型

### 6.1 `system_config`

`system_config` 是单行宽表，`id` 固定为 `1`。该表保存全局安全配置，避免 key-value 表带来的类型不明确和字段不可见问题。

```sql
CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),

    -- 当前安全入口路径，空字符串表示关闭。
    safe_entry TEXT NOT NULL DEFAULT '',
    -- 是否启用密码复杂度校验：0 关闭，1 开启。
    password_complexity INTEGER NOT NULL DEFAULT 0,

    -- 授权访问 IP 或 CIDR 列表，JSON 数组。
    allowed_ips TEXT NOT NULL DEFAULT '[]',
    -- 是否启用域名绑定：0 关闭，1 开启。
    domain_binding_enabled INTEGER NOT NULL DEFAULT 0,
    -- 允许访问服务的绑定域名列表，JSON 数组。
    bound_domains TEXT NOT NULL DEFAULT '[]',

    -- 密码过期天数，0 表示不过期。
    password_expires_days INTEGER NOT NULL DEFAULT 0,
    -- 触发登录锁定的失败次数。
    login_lockout_threshold INTEGER NOT NULL DEFAULT 5,
    -- 登录锁定时长，单位分钟。
    login_lockout_minutes INTEGER NOT NULL DEFAULT 15,
    -- 是否启用验证码功能：0 关闭，1 开启。
    captcha_enabled INTEGER NOT NULL DEFAULT 1,

    -- 两步验证总开关：0 关闭，1 开启。
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    -- 启用的两步验证方式列表，JSON 数组。
    two_factor_methods TEXT NOT NULL DEFAULT '[]',
    -- TOTP 发行方名称。
    totp_issuer TEXT NOT NULL DEFAULT 'Veydeck',

    -- 通行密钥登录开关：0 关闭，1 开启。
    passkey_enabled INTEGER NOT NULL DEFAULT 0,
    -- 通行密钥策略配置，JSON 对象。
    passkey_policy TEXT NOT NULL DEFAULT '{}',

    -- API 接口访问总开关：0 关闭，1 开启。
    api_access_enabled INTEGER NOT NULL DEFAULT 0,
    -- API Token 认证开关：0 关闭，1 开启。
    api_token_enabled INTEGER NOT NULL DEFAULT 0,
    -- API Token 默认过期天数，0 表示不过期。
    api_token_expires_days INTEGER NOT NULL DEFAULT 0,
    -- API CORS 授权来源列表，JSON 数组。
    api_allowed_origins TEXT NOT NULL DEFAULT '[]',
    -- API 限流策略配置，JSON 对象。
    api_rate_limit TEXT NOT NULL DEFAULT '{}',

    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

迁移必须初始化唯一配置行：

```sql
INSERT OR IGNORE INTO system_config (id) VALUES (1);
```

### 6.2 已启用字段

| 字段 | 说明 |
| --- | --- |
| `safe_entry` | 当前安全入口，空字符串表示关闭 |
| `password_complexity` | 密码复杂度开关 |

### 6.3 已预置但未启用字段

| 字段 | 说明 |
| --- | --- |
| `allowed_ips` | 授权访问 IP 或 CIDR 列表 |
| `domain_binding_enabled` | 域名绑定开关 |
| `bound_domains` | 允许访问服务的域名列表 |
| `password_expires_days` | 密码过期天数 |
| `login_lockout_threshold` | 登录锁定失败阈值 |
| `login_lockout_minutes` | 登录锁定时长 |
| `captcha_enabled` | 验证码开关 |
| `two_factor_enabled` | 两步验证总开关 |
| `two_factor_methods` | 两步验证方式列表 |
| `totp_issuer` | TOTP 发行方名称 |
| `passkey_enabled` | 通行密钥登录开关 |
| `passkey_policy` | 通行密钥策略 |
| `api_access_enabled` | API 接口访问总开关 |
| `api_token_enabled` | API Token 认证开关 |
| `api_token_expires_days` | API Token 默认过期天数 |
| `api_allowed_origins` | API CORS 授权来源列表 |
| `api_rate_limit` | API 限流策略 |

---

## 7. API

### 7.1 登录相关

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/login` | 管理员登录 | 无 |
| `GET` | `/api/v1/auth/me` | 获取当前会话 | 会话 Cookie |
| `POST` | `/api/v1/auth/logout` | 退出登录 | 会话 Cookie |
| `GET` | `/api/v1/auth/captcha-status` | 查询当前 IP 验证码状态 | 无 |
| `GET` | `/api/v1/captcha` | 获取验证码图片 | 无 |

登录失败响应必须带有可供前端国际化的 `messageKey`。

### 7.2 安全设置

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/security/settings` | 读取安全入口和密码复杂度配置 | 会话 Cookie |
| `PUT` | `/api/v1/security/settings` | 更新安全入口和密码复杂度配置 | 会话 Cookie |
| `PUT` | `/api/v1/security/password` | 修改管理员密码 | 会话 Cookie |
| `PUT` | `/api/v1/security/username` | 修改管理员用户名 | 会话 Cookie |

安全设置响应字段使用 camelCase：

```json
{
  "safeEntry": "a3xK9mPqR2nL5wYt",
  "safeEntryEnabled": true,
  "passwordComplexity": false
}
```

修改密码请求不包含旧密码：

```json
{
  "newPassword": "new_password"
}
```

修改用户名请求不包含旧密码：

```json
{
  "newUsername": "veydeck"
}
```

---

## 8. 前端协作

- 登录页加载时先查询验证码状态。
- 只有后端返回需要验证码时才显示验证码输入区。
- 验证码展示在密码输入框下方。
- 登录成功后必须调用 `/api/v1/auth/me` 确认会话有效，再进入桌面。
- 安全入口开启时，浏览器地址栏保持安全入口路径，不显示 `/login`。
- 设置应用提供安全入口、密码复杂度、用户名和密码修改入口。
- 前端本地校验安全入口格式和保留前缀；后端仍作为最终校验边界。
- 前端 401 响应优先使用后端 `messageKey` 做国际化展示。

---

## 9. `slctl`

`slctl` 是本机 root 管理工具。运行时必须检查当前用户为 root；root 权限代表本机管理授权，不再要求旧密码。

| 命令 | 说明 |
| --- | --- |
| `slctl info` | 显示真实默认访问地址、管理员用户名、安全入口和面板登录地址 |
| `slctl passwd` | 修改管理员密码 |
| `slctl passwd --username <username>` | 同时修改管理员用户名和密码 |
| `slctl user --username <username>` | 仅修改管理员用户名 |
| `slctl entry` | 查看当前安全入口 |
| `slctl entry --regenerate` | 重新生成安全入口 |
| `slctl entry --set <entry>` | 设置自定义安全入口 |
| `slctl entry --disable` | 关闭安全入口 |

`slctl` 不提供查看密码功能。

---

## 10. 安全边界

- Base64 只用于安全入口 Cookie 记录，不用于登录密码或修改密码参数编码。
- 登录和修改密码接口通过 HTTPS 传输 JSON 参数。
- 密码不得写入 URL、日志、平台事件 metadata 或前端存储。
- 服务端只保存密码哈希。
- 安全入口不是认证凭据，只是登录页暴露面控制。
- 真正认证仍依赖 `veydeck_session` HttpOnly Cookie 与服务端 Session。

---

## 11. 验收标准

- 新安装环境不会生成固定 `admin/admin`。
- debug 开发模式缺少 bootstrap 文件时可使用 `admin/admin` 登录，且默认不启用安全入口。
- 安装完成后只在最终结果中展示登录地址、用户名和密码。
- 安全入口开启时，直接访问 `/` 或未授权 `/login` 不显示登录页。
- 安全入口关闭后，旧安全入口不可继续作为登录路径使用。
- 失败一次后再次登录需要验证码。
- 验证码错误、凭证错误、锁定等响应包含 `messageKey`。
- 修改密码在复杂度关闭时仍拒绝 5 位以下密码。
- `slctl info` 能显示真实默认访问地址和当前安全入口。
- `system_config` 迁移后只有一行全局配置，`id = 1`。
