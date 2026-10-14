# Veydeck 跨 NAT 节点回连地址设计规范

本文档定义 Veydeck 在跨网段、NAT、端口转发和反向代理场景下的 Agent 回连地址模型。

---

## 1. 问题边界

Veydeck 分布式部署包含两个方向的网络连接：

1. 主控 `veydeck` 通过 SSH 访问目标节点，完成文件上传、配置写入和 systemd 服务安装。
2. 子节点 `veydeck-agent` 启动后主动访问主控 `veydeck`，完成注册、心跳、证书轮换和运行时通信。

在 NAT 场景中，主控可能可以通过 OpenWrt、跳板网关或端口转发访问子节点 SSH，但子节点无法访问主控的内网地址。此时 SSH 部署可以完成，Agent 注册会失败。

---

## 2. 设计目标

1. Agent 写入配置时必须使用子节点侧可访问的主控地址。
2. 默认主控地址推导只作为兜底，不作为跨 NAT 场景的唯一来源。
3. 单节点部署允许覆盖主控回连地址。
4. 回连地址覆盖值必须与最终写入 `agent.toml` 的 `veydeckUrl` 一致。
5. 主控与子节点运行时通信必须满足 HTTPS/mTLS 安全模型。
6. 后端不硬编码中文错误信息。
7. 全局默认访问地址变更时，应同步更新仍使用旧默认回连地址的功能节点。

---

## 3. 地址模型

### 3.1 主控监听地址

主控监听地址表示 `veydeck` 服务绑定的本机地址，例如：

```text
0.0.0.0:7310
192.168.1.10:7310
```

该地址用于主控自身监听，不等同于 Agent 可访问地址。

### 3.2 默认访问地址

默认访问地址表示主控对外呈现的访问主机名或 IP。它用于：

1. Web 页面需要拼装主控访问 URL 的场景。
2. Docker 应用快捷入口等需要生成服务跳转地址的场景。
3. 未显式覆盖回连地址的功能节点默认 `veydeckUrl`。

默认访问地址不是监听绑定地址。仅修改默认访问地址不得触发端口占用检测，也不需要重启主控。

### 3.3 Agent 回连地址

Agent 回连地址表示子节点访问主控时使用的完整 URL，例如：

```text
https://controller.example.com:9443
https://203.0.113.10:9443
https://openwrt.example.net:19090
```

Agent 回连地址写入：

```toml
veydeckUrl = "https://controller.example.com:9443"
```

---

## 4. 配置来源与优先级

最终 `veydeckUrl` 按以下优先级解析：

1. 单次部署请求中的 `veydeckUrl`。
2. 环境变量 `VEYDECK_PUBLIC_URL`。
3. 运行时网络配置中的 `public_host`，结合当前主控端口生成 URL。
4. 环境变量 `VEYDECK_PUBLIC_HOST`，结合当前主控端口生成 URL。
5. 主控运行时监听配置与本机网卡地址推导结果。

单次部署请求中的 `veydeckUrl` 只影响本次部署写入的 Agent 配置，不修改全局运行时网络配置。

全局运行时网络配置中的 `public_host` 是默认访问地址，也是默认回连地址的主机来源。节点自身已经保存了不同于旧默认回连地址的 `veydeckUrl` 时，视为节点级自定义地址，不被全局默认访问地址变更覆盖。

首次执行 `deploy/install.sh` 时，安装脚本必须在端口确定后提示默认回连主机。该字段只允许输入 IP 或域名，不输入协议和端口；协议固定为 `https`，端口使用前一步确定的主控端口。脚本淡色展示检测到的完整预览 URL，用户直接回车时使用检测值，并通过 `veydeck init-runtime-config --public-host` 写入运行时网络配置。

---

## 5. URL 规范

`veydeckUrl` 必须满足：

1. 使用完整 URL，包含协议、主机和端口。
2. 协议只允许 `https`。
3. 不允许包含路径、查询参数和 fragment。
4. 结尾 `/` 在写入前统一移除。
5. 主机允许域名、IPv4 或 IPv6 字面量。

示例：

```text
https://controller.example.com:9443
https://203.0.113.10:19090
https://[2001:db8::10]:9443
```

非法示例：

```text
controller.example.com:9443
http://203.0.113.10:19090
https://controller.example.com:9443/api/v1
https://controller.example.com:9443?token=abc
```

---

## 6. 部署写入规则

SSH 部署阶段生成 Agent 配置时，必须使用最终解析出的 `veydeckUrl`：

```toml
mode = "remote"
listenAddr = "0.0.0.0:7311"
agentId = "<node-id>"
agentIp = "<ssh-target-address>"
veydeckUrl = "<resolved-agent-callback-url>"
enrollmentToken = "<one-time-token>"
```

部署日志中不得输出 `enrollmentToken`。

---

## 7. 可用性检测回连探针

可用性检测阶段必须使用最终解析出的 `veydeckUrl` 执行目标节点到主控的回连检测：

1. 主控通过 SSH 在目标节点侧访问 `<veydeckUrl>/api/v1/runtime/callback-probe`。
2. 探针接口必须无状态，不创建注册、心跳、会话或证书记录。
3. 回连探针优先级仅次于 SSH；SSH 成功后必须先执行回连探针，再执行系统、权限、目录、端口、Docker 和已有服务检测。
4. 目标节点无法访问探针接口时，本次预检失败并阻断部署，其余预检项不再执行并返回 `skipped`。
5. 自签名证书场景下，回连探针允许跳过证书链校验，只验证目标节点到主控 HTTPS 入口的网络可达性。
6. 预检通过后，部署请求必须使用同一个 `veydeckUrl` 写入 `agent.toml`。

---

## 8. 前端交互

新增节点表单增加“主控回连地址”字段：

1. 允许用户为单个节点覆盖。
2. 字段为空时由后端按优先级解析默认值。
3. 字段非空时作为本次预检和部署请求的 `veydeckUrl` 提交。

字段说明使用中性描述：

```text
子节点访问主控时使用的地址。跨 NAT、端口转发或反向代理场景需要填写子节点侧可访问的 URL。
```

---

## 9. 后端接口变更

### 9.1 节点预检和部署请求

`NodePrecheckPayload`、`NodeDeployCreatePayload` 和单节点部署请求增加：

```json
{
  "veydeckUrl": "https://controller.example.com:9443"
}
```

后端部署链路必须使用统一的 URL 解析函数，避免配置来源在不同部署入口中产生差异。

### 9.2 主控网络配置更新

`PUT /api/v1/veydeck/network` 同时维护监听地址与默认访问地址：

1. `host` 或 `port` 表示主控监听配置。监听配置变更后保存运行时配置，并安排主控重启生效。
2. `publicHost` 表示默认访问地址。仅修改 `publicHost` 时只更新运行时配置和进程内活跃配置，不执行端口占用检测，不重启主控。
3. 只有 `port` 变化时才执行端口占用检测。默认访问地址不是本机绑定地址，不参与端口监听校验。
4. 默认回连 URL 变化后，主控枚举功能节点部署记录，并仅同步满足以下条件的节点：
   - 节点不是本地节点 `local`。
   - 节点当前 `veydeckUrl` 为空，或等于旧默认回连 URL。
   - 节点当前存在在线运行时会话。
5. 节点当前 `veydeckUrl` 不等于旧默认回连 URL 时，认为该节点使用 NAT、端口映射或反向代理自定义地址，必须跳过同步。
6. 同步通过功能节点接口 `PUT /api/v1/agent/system/veydeck-url` 写入 `agent.toml`，功能节点随后由进程管理器重启生效。
7. 主控同步成功后更新 `node_provisioning.veydeck_url`，保证后续升级制品下载链接继续使用节点侧可访问地址。

`veydeck init-runtime-config` 支持 `--public-host <IP_OR_DOMAIN>`，用于首次安装阶段写入默认访问主机。该参数不得包含协议、端口、路径、查询参数或 fragment。

### 9.3 Runtime 回连探针

新增公开只读接口：

```text
GET /api/v1/runtime/callback-probe
```

该接口只返回主控版本和运行时协议版本，不返回认证材料、节点身份或主控内部网络配置。

---

## 10. OpenWrt 端口转发场景

典型拓扑：

```text
veydeck controller
  192.168.1.10:7310
        |
        | OpenWrt 端口转发
        v
openwrt.example.net:19090
        |
        v
veydeck-agent node
```

此时 Agent 回连地址应配置为：

```text
https://openwrt.example.net:19090
```

不应写入：

```text
https://192.168.1.10:7310
```

---

## 11. 安全约束

1. `veydeckUrl` 必须使用 `https`。
2. 主控访问 Agent 执行面必须使用 mTLS。
3. Agent 回连主控必须走 HTTPS 入口，并保留注册、心跳、证书轮换等运行时身份校验。
4. 回连地址不承载认证 token。
5. 注册认证仍由一次性 `enrollmentToken` 与后续证书身份完成。
6. 端口转发、反向代理或公网暴露时，主控必须保留认证、审计和证书校验。
7. 单节点覆盖地址不得改变其他节点的已写入配置。
8. 全局默认访问地址自动同步不得覆盖节点级自定义 `veydeckUrl`。

首次安装或证书缺失时，主控服务端证书必须签发以下 SAN：`127.0.0.1`、`::1`、`localhost`、系统 `<hostname>`、`<hostname>.lan`、运行时网络配置中的默认回连主机。已有证书存在时不在启动阶段自动重签，避免隐式改变节点信任关系。

---

## 12. 事件日志

默认访问地址变更必须记录平台事件日志：

1. 主控配置变更记录 `veydeck_network_update`，目标为 `veydeck/network`。
2. 每个功能节点同步决策记录 `node_veydeck_url_sync`，目标为对应 `node_id`。
3. `node_veydeck_url_sync` 的 `metadata.syncResult` 取值：
   - `synced`：已调用功能节点接口并成功更新。
   - `failed`：已调用功能节点接口但更新失败。
   - `skipped_custom`：节点有自定义回连地址，未覆盖。
   - `skipped_offline`：节点不在线，未同步。
4. 事件日志 metadata 必须包含旧默认回连 URL、新默认回连 URL、节点原始 `veydeckUrl` 和失败错误详情。
