# Veydeck API 治理中心

本目录是 Veydeck 组织 API 设计规范、接口契约和接口目录的唯一来源。接口契约采用 OpenAPI 3.1 YAML 手工维护，Vue 工作台负责聚合和展示，不替代业务服务。

## 规范

- [API 设计规范](standards/api-design.md)：路径、方法、字段、响应、错误和通信规则。
- [OpenAPI 契约规范](standards/contract.md)：契约结构、Schema、命名和扩展字段。
- [API 治理规范](standards/governance.md)：登记、核对、偏移、变更和废弃流程。

## 目录

```text
api/
├── catalog.yaml
├── standards/
│   ├── api-design.md
│   ├── contract.md
│   └── governance.md
├── specs/
│   └── veydeck/
│       ├── control-plane.yaml
│       └── agent.yaml
├── scripts/
│   └── validate.mjs
└── src/
```

`catalog.yaml` 是组织项目和契约文件的登记入口。新增项目或服务时先登记 catalog，再新增对应 OpenAPI 文件。

## 开发命令

```bash
pnpm install
pnpm dev
pnpm build:favicon
pnpm validate
pnpm check
pnpm build
```

- `pnpm dev`：启动本地 API 工作台。
- `pnpm build:favicon`：从 `public/favicon.svg` 生成多尺寸 `favicon.ico`。
- `pnpm validate`：校验 OpenAPI、目录引用、重复接口和治理字段。
- `pnpm check`：执行契约校验、类型检查和静态构建。
- `pnpm build`：生成可静态部署的 `dist/`。

第一阶段不提供在线请求功能，不接入 Axum 自动生成、类型生成和 CI。
