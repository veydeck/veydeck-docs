# Veydeck 网站管理套件设计

## 定位与交付

网站管理套件用于在节点上部署静态网站和反向代理，支持 HTTPS、WebSocket、IPv6、证书管理、日志与备份。

源码由 `veydeck-suite-websites` 维护，交付目录为 `veydeck-suites/suites/veydeck.websites`。前端使用 Vue 3 与 Vite，后端使用 Rust、Axum 和 SQLite。

套件运行两个容器：

| 服务 | 镜像 | 职责与网络 |
| --- | --- | --- |
| `manager` | `veydeck/website-manager` | 管理界面、业务 API、配置生成和数据维护；接入 `veydeck-suite-network`。 |
| `nginx` | 官方 `nginx` | 静态文件、反向代理和 TLS；使用宿主机网络监听网站端口。 |

交付配置固定镜像版本。管理服务重启时，Nginx 可继续提供已经加载的网站服务。

## 平台资源声明

套件清单声明：

```yaml
runtime:
  resources:
    engineService: nginx
    managerService: manager
  agent:
    services: [manager]
    capabilities: [services.control, operation-logs.write]
```

两个服务名称仅允许小写字母、数字和短横线，长度为 1–64；管理服务与引擎服务必须不同，且均存在于 Compose 配置。管理服务必须列入 Runtime 注入白名单并声明 `services.control`。

业务数据目录由平台根据套件 ID 固定分配：`veydeck.websites` 对应 `/opt/veydeck/data/www/websites`，与 Compose 部署目录 `/opt/veydeck/data/compose/suite/veydeck-websites` 隔离。套件不能自定义顶层目录或通过清单声明命名空间。安装时生成 `.env` 和 `compose.resources.yaml`，提供数据路径、实例 ID 和只读管理入口凭据文件。

平台分配的业务目录在节点内独占，归属记录保存为 `.owner.json`。专用根目录、业务目录和归属文件均拒绝符号链接，没有归属记录的已有非空目录不能被认领。卸载默认保留业务数据；重新安装时，只有同套件、原部署目录已释放且安装请求显式设置 `adoptRetainedData`，才允许接管保留数据。显式删除数据前必须核对套件、实例和项目三项归属，仅删除平台分配的业务目录。

## 受限 Nginx 控制

管理服务通过 Runtime SDK 的通用 `request()` 方法调用：

```text
POST /api/v1/agent/suite-runtime/services/{action}
```

请求需要实例 Bearer 令牌和 `services.control` 能力。Agent 从认证身份解析所属 Compose 项目及声明的引擎服务，通过 Compose 标签定位唯一运行容器。

| 动作 | 行为 |
| --- | --- |
| `validate` | 接收 UUID 格式的 `revision`，使用 `nginx -t` 检查对应配置版本。 |
| `reload` | 平滑加载 `current/nginx.conf`。 |
| `reopen` | 重新打开日志文件。 |
| `status` | 查询 Nginx 版本。 |

操作使用固定命令和路径，等待上限为 30 秒。重载请求成功表示信号已提交，管理服务随后通过私有 Unix socket 确认工作进程返回目标配置版本，再确认业务操作成功。

## 管理入口认证

管理界面通过 Veydeck 代理访问。Agent 清理请求中用户提供的 `x-veydeck-*` 内部头，向管理服务注入 `x-veydeck-entry-token`。管理服务从凭据文件读取并校验该值，`/health` 用于匿名健康检查。

入口凭据保留在平台与服务端之间。浏览器 Bridge 用于主题、语言、通知和导航，业务授权由管理入口与 Runtime 实例认证承担。

## 网站与文件管理

网站使用内部 UUID 关联配置，使用节点内唯一的代号确定数据目录。代号默认取第一个域名，创建时可自定义；修改域名保持目录不变。

域名必填，同一端口内规范化后的域名不能重复，不同端口允许复用。IPv4 默认监听 `0.0.0.0`，可额外开启 IPv6。域名填写 `0.0.0.0` 表示对应端口的默认网站，适用于局域网按 IP 和端口访问。

静态网站创建时始终生成：

```text
/opt/veydeck/data/www/websites/sites/<代号>/index/index.html
/opt/veydeck/data/www/websites/sites/<代号>/index/404.html
```

运行目录默认为 `index` 本身，内部相对路径为 `.`；可选择其下子目录，保存并重载后生效。文件内容修改直接生效，静态网站支持 SPA 回退。

网站详情展示实际宿主机路径。文件夹按钮通过 Bridge 导航打开文件管理，主控将目标节点固定为套件所在节点，并传递目录绝对路径。文件上传与编辑由文件管理应用承担。

反向代理可连接节点本机或其他可达地址的服务端口。网站创建、修改、启停和删除直接触发配置检查、切换与重载；失败时恢复原状态。配置版本用于后台一致性与失败恢复。

## 配置、日志与备份

全局配置为 `instances/<实例ID>/current/nginx.conf`，通过 `include` 加载 `conf.d/<代号>.conf`。网站配置与全局配置分别保存。

| 数据 | 相对套件数据目录的路径 |
| --- | --- |
| 网站文件 | `sites/<代号>/index/` |
| 实例状态与数据库 | `instances/<实例ID>/state/` |
| 网站证书 | `instances/<实例ID>/certificates/` |
| 配置版本 | `instances/<实例ID>/releases/` |
| Nginx 服务日志 | `instances/<实例ID>/logs/nginx/` |
| 网站访问与错误日志 | `instances/<实例ID>/logs/sites/<代号>/` |

访问与错误日志分别写入 `access.log` 和 `error.log`，按日轮转并清理超过保留期的历史日志。两个容器的标准输出日志由 Docker 分别限额保存。

备份包含 SQLite 一致性快照、证书与私钥、网站文件及配置，排除运行 socket。文件管理可独立修改网站内容，归档期间的外部写入不具备跨文件事务一致性。

## 证书

上传证书时校验 PEM、有效期和私钥匹配关系，自动解析主域名、其他域名、颁发组织、有效期等信息。界面按用户语言和本地时区展示时间，证书 API 不回传私钥。

每个实例独立生成内置根证书，也可创建自定义根证书，为域名或 IPv4、IPv6 地址签发网站证书。签发有效期以年为单位，默认 10 年；内置根证书到期时间为 `9999-12-31`。使用本地签发的证书时，客户端需要信任对应根证书。根私钥随实例数据持久保存并纳入备份。

## 界面组织

左侧导航分为网站、证书和设置：

- 网站：网站列表，展示名称、类型、协议、启用按钮、目录入口和操作。
- 证书：证书列表、自签证书、上传证书。
- 设置：性能、日志、备份。

性能模块编辑 Nginx 全局参数，包括域名哈希桶、请求头缓冲区、请求体大小、长连接超时与 gzip 设置，校验通过后保存并重载。

网站、证书和自签证书列表使用分页。切换日志类型或来源后自动刷新内容。界面支持简体中文和英文，跟随主控语言切换，并保留当前输入与分页位置。
