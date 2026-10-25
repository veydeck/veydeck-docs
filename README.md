# Veydeck 文档

**Veydeck — 可扩展的分布式 Linux 主机运维平台。**

Veydeck 是一个可扩展的分布式 Linux 主机运维平台，用于统一管理一台或多台 Linux 主机，并支持通过套件按需扩展平台能力。

`veydeck-docs` 是 Veydeck 组织级文档源，用于维护跨仓库共享的架构、规范、运行、套件、仿真和 API 治理文档。

## 文档目录

| 目录 | 内容 |
| --- | --- |
| `architecture/` | 系统架构、Crate 边界、节点管理和计划任务设计。 |
| `standards/` | 主题 Token、运行环境、部署目录、认证、日志和 WebSocket 规范。 |
| `operations/` | 运行时协议、跨 NAT 回连和在线升级规范。 |
| `simulation/` | 协议仿真、PCAP 取证、规则包规范和跨仓库兼容性契约。 |
| `suites/` | Compose 套件中心、套件开发规范和套件 SDK 设计规范。 |
| `api/` | API 设计规范、契约、治理规则和可视化工作台。 |

## 协议仿真文档

- [Veydeck 协议仿真模块设计规范](simulation/Veydeck协议仿真模块设计规范.md)
- [Veydeck 协议仿真规则包设计规范](simulation/Veydeck协议仿真规则包设计规范.md)
- [Veydeck 协议仿真套件与规则库兼容性契约](simulation/Veydeck协议仿真套件与规则库兼容性契约.md)
- [Veydeck 协议仿真 PCAP 取证设计规范](simulation/Veydeck交互式PCAP流量取证设计规范.md)

协议仿真还依赖 [Veydeck 套件系统实现规范](suites/Veydeck套件系统实现规范.md)、[Veydeck Compose 套件开发规范](suites/VeydeckCompose套件开发规范.md) 和 [Veydeck 套件 SDK 设计规范](suites/Veydeck套件SDK设计规范.md) 中的 Suite Runtime 契约。

## 网站管理套件文档

- [Veydeck 网站管理套件设计](suites/Veydeck网站管理套件设计.md)：Nginx 双容器架构、资源归属、服务控制、网站目录、证书和备份。

## API 工作台

```bash
pnpm -C api install
pnpm -C api dev
```

## 维护规则

1. 文档内容使用中文。
2. 文档描述保持正式、简洁、正向。
3. 跨仓库共享规范只在本仓库维护。
4. 业务仓库通过公开仓库链接引用本仓库文档。
