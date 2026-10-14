# Veydeck Compose 套件开发规范

## 1. 目标

本文档面向 Veydeck Compose 套件作者，定义套件目录结构、`suite.yaml` 清单、Compose 编写约束、应用入口声明、配置变量、日志、升级和交付检查规则。

套件的本质是一个受 Veydeck 管理的 Docker Compose 项目。套件作者只负责提供声明完整、可校验、可启动、可升级的套件包；主控和 Agent 负责安装、运行、状态采集和应用库集成。

## 1.1 运行模型

Veydeck 套件按节点安装和运行。套件目录是全局资源，套件实例是节点资源。

运行规则：

1. 同一节点上同一 `suiteId` 只能存在一个套件实例。
2. 同一套件可以分别安装到不同节点。
3. 应用库和桌面只展示当前节点可用的套件入口。
4. 套件应用入口、桌面快捷方式和安装进度均以 `nodeId` 为作用域。
5. 本地节点固定使用 `local` 标识。

## 2. 套件仓库目录结构

Veydeck 套件采用源码仓库与交付仓库分离的结构：源码仓库维护应用代码和镜像构建，`veydeck-suites` 维护套件版本目录和 `.vsp` 交付包。

```text
veydeck-suites/
├── scripts/
│   ├── package.sh
│   └── package-all.sh
├── suites/
│   └── veydeck.host-scanner/
│       ├── suite.yaml
│       ├── compose.yaml
│       ├── .env.example
│       ├── README.md
│       ├── CHANGELOG.md
│       └── assets/
│           └── suite-icon.png
└── releases/
```

套件目录不再包含分类层级和版本层级。分类以 `suite.yaml` 的 `metadata.category` 为准，版本以 `suite.yaml` 的 `metadata.version` 和发布 tag 为准。

分类只保留：

| 分类 | 说明 |
| --- | --- |
| `tools` | 通用工具箱、编码转换、辅助实用工具。 |
| `other` | 暂未归类或不适合放入工具分类的套件。 |

目录职责：

| 目录 | 是否打包 | 说明 |
| --- | --- | --- |
| `veydeck-suite-<slug>/` | 否 | 独立源码仓库，维护应用源码、Dockerfile、测试代码和镜像发布流程。 |
| `suites/<suiteId>/` | 是 | 套件中心导入的交付文件，打包脚本读取该目录并以 `suite.yaml` 中的版本生成 `.vsp`。 |

Web 套件推荐在源码仓库内拆分服务端与静态前端资源，不推荐把整页 HTML、CSS 和 JS 内联在后端源码中：

```text
veydeck-suite-<slug>/
├── Dockerfile
├── main.py
└── static/
    ├── css/
    │   └── style.css
    ├── index.html
    └── js/
        └── app.js
```

## 3. 套件交付目录结构

`suites/<suiteId>/` 目录是实际进入 `.vsp` 的交付内容。`.vsp` 内部仍是 gzip 压缩的 tar 归档；归档根目录的 `suite.yaml` 必须声明 `kind: suite`，用于识别包类型：

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

交付文件要求：

| 文件 | 必需 | 说明 |
| --- | --- | --- |
| `suite.yaml` | 是 | 套件清单，必须符合 Veydeck 套件 schema。 |
| `compose.yaml` | 是 | 唯一允许的 Docker Compose 文件名，必须可以通过 `docker compose config`。 |
| `.env.example` | 否 | 安装表单变量模板，不允许包含真实密钥；无变量时可省略或只写说明注释。 |
| `README.md` | 推荐 | 说明用途、默认账号、端口、数据目录和升级注意事项。 |
| `CHANGELOG.md` | 推荐 | 记录用户可理解的版本变化。 |
| `assets/suite-icon.png` | 是 | 套件中心和应用库展示图标，必须是至少 128×128 的正方形 PNG，推荐 256×256 透明 PNG。应用入口默认继承该图标。 |

## 4. 套件 ID 与版本

套件 ID 使用反向域名或组织前缀格式：

```text
veydeck.asset-mapper
veydeck.vuln-lab
vendor.product-name
```

规则：

1. 只允许小写字母、数字、点号和短横线。
2. 一经发布不得修改。
3. 同一套件的应用入口 ID 必须在套件内唯一。
4. 版本号使用 SemVer，例如 `0.1.0-alpha.1`、`0.2.0`、`0.3.0`。
5. 不兼容升级必须提升主版本号，并在 `CHANGELOG.md` 中说明迁移影响。

## 5. `suite.yaml` 最小示例

```yaml
apiVersion: veydeck.io/v1alpha1
kind: ComposeSuite
metadata:
  suiteId: veydeck.example-app
  slug: example-app
  version: 0.1.0-alpha.1
  name: 示例套件
  summary: 用于演示 Veydeck Compose 套件的最小结构。
  icon: assets/suite-icon.png
  minVeydeckVersion: 0.1.0-alpha.1
  category: tools

compatibility:
  platformContractVersion: 1

runtime:
  type: compose
  composeFile: compose.yaml
  projectNameTemplate: veydeck-{suiteId}-{instanceShortId}
  network:
    name: veydeck-suite-network
    external: true

services:
  - name: web
    role: web
    health:
      type: http
      path: /health
      port: 8080

appEntries:
  - id: main
    title: 示例套件
    type: proxied_web
    service: web
    port: 8080
    path: /
    window:
      width: 1200
      height: 760
      minWidth: 960
      minHeight: 640

permissions:
  network:
    outbound: true
  volumes:
    named: true
    hostPaths: []
  dangerous:
    privileged: false
    hostNetwork: false
    dockerSocket: false
```

## 6. `suite.yaml` 字段说明

### 6.1 `metadata`

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `suiteId` | 是 | 全局唯一套件 ID。 |
| `version` | 是 | 套件版本。 |
| `name` | 是 | 展示名称。 |
| `summary` | 是 | 一句话说明。 |
| `icon` | 是 | 套件默认 logo，必须指向包内 `assets/` 下真实存在的 PNG、WebP 或 SVG；推荐使用 `assets/suite-icon.png`。 |
| `category` | 是 | 套件分类，只支持 `tools` 和 `other`；缺省或值非法时归入 `other`。 |
| `slug` | 是 | 稳定的小写短名称，用于生成 Compose 项目名。 |
| `minVeydeckVersion` | 是 | 最低 Veydeck 平台版本；导入时必须通过 SemVer 格式和当前平台版本校验。 |
| `homepage` | 否 | 项目主页。 |
| `license` | 否 | 许可证。 |

### 6.2 `compatibility`

`compatibility` 声明套件依赖的平台运行契约：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `platformContractVersion` | 是 | 正整数平台运行契约版本；当前值为 `1`。导入时必须属于当前 Veydeck 支持的契约版本集合。 |

平台运行契约描述 Veydeck 与套件之间的安装、实例、代理、Runtime 注入和生命周期边界。它不等同于以下版本：

| 字段 | 用途 |
| --- | --- |
| `metadata.version` | 套件自身的 SemVer 版本。 |
| `metadata.minVeydeckVersion` | 套件可运行的最低 Veydeck 产品版本。 |
| Runtime 描述 `schemaVersion` | 套件后端与 Agent Runtime SDK 的 JSON 结构版本。 |

套件作者必须按当前平台契约填写该值，不能使用套件版本、镜像版本或 `apiVersion` 推导。

### 6.3 `runtime`

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `type` | 是 | v1 固定为 `compose`。 |
| `composeFile` | 是 | Compose 文件路径，通常是 `compose.yaml`。 |
| `projectNameTemplate` | 否 | Compose project 名称模板；未提供时由平台生成。 |
| `images` | 否 | 套件依赖的额外 workload 镜像；安装时会预拉取，并作为 Agent 创建 workload 的镜像白名单。Compose 文件中的镜像会自动解析，但不会自动进入该白名单。 |

### 6.4 `runtime.agent`

套件后端需要调用本节点 Agent 的受控能力时声明 `runtime.agent`：

```yaml
runtime:
  images:
    - vendor/example-worker:0.1.0-alpha.1
  agent:
    services:
      - web
    capabilities:
      - workloads.manage
      - captures.manage
      - operation-logs.write
```

| 字段 | 说明 |
| --- | --- |
| `services` | 允许注入 Runtime 描述与凭据的 Compose service 名称，必须存在于 Compose 文件中。 |
| `capabilities` | 授予这些服务的最小能力集合。 |

当前支持的能力：

- `workloads.manage`：创建、查询、停止和删除具名 TCP/UDP 多端点 workload。
- `captures.manage`：对所属 workload 的全部已发布端点执行整 workload 抓包。
- `operation-logs.write`：提交语义化平台操作事件。

未使用 Agent Runtime 的套件不要声明 `runtime.agent`。需要时只授权实际调用 SDK 的服务，并把动态 workload 所需镜像逐项列入 `runtime.images`。

### 6.5 `config`

`config.variables` 用于生成安装表单和 `.env` 文件。

支持类型：

| 类型 | 说明 |
| --- | --- |
| `string` | 普通字符串。 |
| `number` | 数字。 |
| `boolean` | 布尔开关。 |
| `secret` | 敏感值，界面隐藏，日志和审计中脱敏。 |
| `select` | 固定选项。 |

变量规则：

1. 变量名必须是大写字母、数字和下划线。
2. `secret` 不得写入 `README.md` 示例真实值。
3. 必填变量必须提供说明。
4. 默认值不得包含真实 token、密码、私钥或生产地址。

### 6.6 `services`

`services` 描述 Veydeck 需要理解的 Compose 服务，不要求列出所有内部服务，但对外提供 UI、API 或健康状态的服务必须声明。

| 字段 | 说明 |
| --- | --- |
| `name` | Compose service 名称。 |
| `role` | `web`、`api`、`worker`、`database` 或 `infra`。 |
| `health` | 健康检查配置。 |

### 6.7 `appEntries`

套件需要出现在应用库时必须声明 `appEntries`。

支持入口类型：

| 类型 | 说明 |
| --- | --- |
| `proxied_web` | 由 Veydeck 代理到套件内部 Web 服务。 |
| `compose_detail` | 打开 Compose 项目详情页。 |
| `external_url` | 打开外部 URL，需明确可信来源。 |

`proxied_web` 必填字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 入口 ID。 |
| `title` | 应用库展示名称。 |
| `service` | Compose service 名称。 |
| `port` | 容器内服务端口。 |
| `path` | 默认路径。 |
| `icon` | 可选图标路径；未填写时继承 `metadata.icon`。 |

### 6.8 `permissions`

权限声明必须与 `compose.yaml` 实际内容一致。Veydeck 会根据声明和 Compose 内容做双向校验。

| 字段 | 说明 |
| --- | --- |
| `network.outbound` | 是否需要访问外网。 |
| `volumes.named` | 是否使用 Docker named volume。 |
| `volumes.hostPaths` | 需要挂载的宿主机路径列表。 |
| `dangerous.privileged` | 是否需要特权容器。 |
| `dangerous.hostNetwork` | 是否需要 host 网络。 |
| `dangerous.dockerSocket` | 是否挂载 Docker socket。 |

## 7. Compose 编写规范

基本规则：

1. 镜像必须固定版本标签，不允许使用 `latest`。
2. 套件安装时会复用目标节点已有镜像，并拉取本地缺失镜像；任一镜像无法获取时整个安装事务失败。
3. 服务名使用小写字母、数字和短横线。
4. 对外提供 UI 或 API 的服务必须配置 `healthcheck`。
5. 日志输出到 stdout 和 stderr，不写死宿主机日志路径。
6. 持久化数据优先使用 named volume。
7. 不得默认使用宿主机绝对路径挂载。
8. 不得默认启用 `privileged`、`network_mode: host`、`pid: host`、`ipc: host`、`devices`。
9. 不得挂载 `/var/run/docker.sock`，除非套件类型明确需要并通过安全评审。
10. Compose 文件中需要添加 Veydeck 标签，便于状态归属和排查。
11. 对外入口服务必须接入 `veydeck-suite-network`。
12. 单例且不需要多副本扩容的套件可以声明稳定的 `container_name`，名称应与平台生成的 Compose 项目名一致。
13. 需要通过 Compose `--scale` 启动多个副本的服务不得声明 `container_name`。
14. `runtime.agent.services` 只能列出实际需要 Agent Runtime 的服务，能力遵循最小授权原则。
15. 动态 workload 使用的镜像必须固定版本并列入 `runtime.images`。

推荐标签：

```yaml
labels:
  veydeck.owner: suite
  veydeck.suite.id: veydeck.example-app
  veydeck.service.role: web
```

最小 Compose 示例：

```yaml
services:
  web:
    image: nginx:1.27-alpine
    restart: unless-stopped
    labels:
      veydeck.owner: suite
      veydeck.suite.id: veydeck.example-app
      veydeck.service.role: web
    networks:
      - veydeck-suite-network
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:80/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
    volumes:
      - web-data:/usr/share/nginx/html

volumes:
  web-data:
    labels:
      veydeck.owner: suite

networks:
  veydeck-suite-network:
    external: true
    name: veydeck-suite-network
```

## 8. 套件专用网络

Veydeck 套件统一使用由 Agent 创建和维护的 Docker 专用网络：

```text
veydeck-suite-network
```

套件作者不需要创建这个网络，但必须在 Compose 文件中声明它是外部网络：

```yaml
networks:
  veydeck-suite-network:
    external: true
    name: veydeck-suite-network
```

对外提供 UI、API 或代理入口的服务必须接入该网络：

```yaml
services:
  web:
    networks:
      - veydeck-suite-network
```

规则：

1. `veydeck-suite-network` 是套件与 Veydeck 代理之间的标准网络。
2. 不要把 `network_mode: host` 当作默认网络方案。
3. 套件可以为数据库、缓存等内部服务额外创建内部网络。
4. 对外入口服务如果同时需要访问内部服务，可以同时加入 `veydeck-suite-network` 和套件内部网络。
5. 不要依赖其他套件的容器名或服务名；跨套件依赖后续由平台显式声明。

## 9. 端口与代理

套件不应要求用户手动记住宿主机端口。推荐模式是容器服务只声明内部端口，由 Veydeck 代理访问：

```yaml
appEntries:
  - id: main
    type: proxied_web
    service: web
    port: 8080
    path: /
```

端口规则：

1. 优先使用容器内部端口加 Veydeck 代理，不直接映射宿主机端口。
2. 如必须映射宿主机端口，端口值必须通过安装变量配置。
3. 不得在 Compose 中写死常见端口，例如 `80:80`、`443:443`、`5432:5432`。
4. 文档必须说明端口用途和冲突处理方式。

## 10. Web 套件 UI 规范

`proxied_web` 套件运行在 Veydeck 的 `SuiteWebApp` 窗口中，视觉和交互应尽量接近主控应用，避免出现明显割裂。

基础规则：

1. Web 套件前端资源应放在 `apps/<语言>/suites/<slug>/static/` 下，推荐 `static/css/style.css`、`static/index.html`、`static/js/app.js`。
2. 后端入口文件只负责 API、健康检查和静态文件服务，不应内联大段 HTML、CSS 和 JS。
3. 页面必须适配 iframe 承载，根元素高度应使用 `100%` 或 `100vh`，避免依赖浏览器整页滚动。
4. 前端请求必须使用相对路径或基于当前路径计算代理前缀，不能假设应用部署在站点根路径 `/`。
5. 声明 `permissions.network.outbound: false` 的套件不得依赖外部 CDN、字体、脚本或图片。
6. 模板结构统一使用 `div` 组织，语义通过 class、`data-page`、`data-ui`、`data-slot` 表达。

视觉规则：

1. 默认使用浅色主题，同时保证深色主题下文本、边框和状态可辨识。
2. 套件应直接引入 `@veydeck/tokens`，不得复制维护另一套 VDL 公共变量。
3. 避免营销式 hero、大面积渐变、装饰性光效、卡通黑客元素、霓虹字符雨和低信息密度布局。
4. 管理类、扫描类、运维类套件应优先使用紧凑工具栏、表格、状态标签、详情面板和可扫描的结果列表。
5. 按钮、输入框、表格、标签、空状态和错误状态应保持稳定尺寸，避免扫描结果或动态文案导致布局跳动。

Veydeck 维护套件与第三方套件分层：

1. Veydeck 维护套件统一使用 Vue 3 + Vite 或 React 19 + Vite，并按目标框架依赖 `@veydeck/vue` 或 `@veydeck/react`，同时按需依赖 `@veydeck/tokens` 与 `@veydeck/icons`。
2. 套件不得从主控 `frontend/src/` 引用源码；共享 UI 能力只能通过 `veydeck-ui` 发布包消费。
3. 第三方套件不强制使用 Vue 或 Veydeck UI 组件库，但必须遵守套件清单、Compose、安全权限、代理路径和基础视觉规则。
4. `@veydeck/suite-sdk` 用于主题、Liquid Glass 材质、语言、通知、导航和主控通信；能力未在其公开 API 中发布前不得依赖内部行为。
5. Vue 与 React 套件应在应用根节点使用对应框架的 `VeyGlassProvider`，将 `SuiteThemeState.glassEnabled` 传给组件库；SDK 同时在目标根节点同步 `data-glass`，供公共 Token 和自绘样式消费。
6. 其它框架的 Veydeck 示例套件至少应引入 `@veydeck/tokens` 的构建产物或使用与其同源的编译结果，不手工复制 Token。

## 11. 数据卷与目录

推荐使用 named volume：

```yaml
volumes:
  app-data:
  postgres-data:
```

宿主机路径挂载仅用于确有必要的场景，且必须在 `suite.yaml` 中声明：

```yaml
permissions:
  volumes:
    hostPaths:
      - path: /opt/veydeck/shared/example
        mode: rw
        reason: 存放用户导入的数据集。
```

规则：

1. 卸载套件时默认保留 named volume。
2. 删除数据必须由用户在卸载时显式确认。
3. 不允许挂载 `/`、`/etc`、`/usr`、`/var/lib/docker` 等高风险目录。

## 12. 配置与密钥

`.env.example` 示例：

```env
ADMIN_PASSWORD=
DATABASE_PASSWORD=
```

规则：

1. `.env.example` 只放变量名、默认值和非敏感示例。
2. 真实 `.env` 由 Veydeck 安装流程生成。
3. 密钥类型变量在界面、日志、审计和错误信息中必须脱敏。
4. 套件不得要求用户手工编辑容器内配置文件才能启动。

## 13. 健康检查与日志

健康检查：

1. Web/API 服务必须提供 HTTP、TCP 或命令型健康检查。
2. 健康检查不能依赖外部公网服务。
3. 首次启动较慢的服务应合理设置 `start_period`。

日志：

1. 应用日志输出到 stdout/stderr。
2. 不在容器内无限制写入本地日志文件。
3. 日志不得打印密钥、token、数据库密码和用户上传的敏感内容。
4. 套件文档应说明主要日志来源和常见错误。

## 14. 升级规范

版本兼容规则：

1. Patch 版本只修复问题，不改变配置 schema。
2. Minor 版本可以新增可选配置，不删除已有配置。
3. Major 版本可以引入不兼容变化，但必须提供迁移说明。

升级时应保证：

1. 新版本 `suite.yaml` 可以识别旧版本安装配置。
2. 数据卷路径保持稳定。
3. 数据库类服务升级前应说明备份要求。
4. 镜像更新后可通过 `docker compose up -d --force-recreate` 恢复运行。
5. 需要一次性迁移任务时，应声明迁移服务或迁移步骤，不能让用户猜测。

## 15. 安全检查清单

发布前必须检查：

1. `docker compose -f compose.yaml config` 通过。
2. 所有镜像固定版本标签。
3. 没有使用 `privileged: true`。
4. 没有挂载 Docker socket。
5. 没有默认使用 host 网络。
6. 没有默认挂载高风险宿主机目录。
7. 所有 Web/API 服务都有健康检查。
8. 所有密钥通过安装变量传入。
9. 日志不会输出敏感值。
10. `suite.yaml` 权限声明与 Compose 内容一致。
11. 对外入口服务已接入 `veydeck-suite-network`。
12. `metadata.minVeydeckVersion` 与使用的 Runtime 能力相匹配。
13. `runtime.agent.services`、`runtime.agent.capabilities` 和 `runtime.images` 已按最小范围声明。
14. `compatibility.platformContractVersion` 是当前平台支持的正整数契约版本。

## 16. 本地验证流程

套件作者在提交前应执行：

```bash
docker compose -f compose.yaml config
docker network inspect veydeck-suite-network >/dev/null 2>&1 || docker network create veydeck-suite-network
docker compose -p veydeck-example -f compose.yaml up -d
docker compose -p veydeck-example -f compose.yaml ps
docker compose -p veydeck-example -f compose.yaml logs --tail=100
docker compose -p veydeck-example -f compose.yaml down
```

如果套件使用 named volume，清理验证环境时再按需执行：

```bash
docker compose -p veydeck-example -f compose.yaml down -v
```

## 17. 交付包检查

交付前 `suites/<suiteId>/` 目录应满足：

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

打包方式：

交付包应由 `veydeck-suites` 的统一打包脚本从 `suites/<suiteId>/` 生成，不手工维护分类或版本目录。

交付包命名规则：

```text
{suite_id}-{version}.vsp
```

示例：

```text
veydeck.example-app-0.1.0-alpha.1.vsp
```

## 18. README 建议内容

套件 README 应包含：

1. 套件用途。
2. 默认入口和默认账号策略。
3. 安装变量说明。
4. 数据卷说明。
5. 升级注意事项。
6. 常见错误和排查方式。
7. 需要的高风险权限说明。

## 19. 不推荐做法

1. 把多个不相关产品塞进一个套件。
2. 依赖宿主机已经安装的随机命令或系统包。
3. 要求用户进入容器手动初始化。
4. 使用浮动镜像标签。
5. 在 Compose 中写死宿主机端口。
6. 默认申请特权容器。
7. 把业务数据写入容器临时文件系统。
8. 在文档或配置模板中放真实密码。
