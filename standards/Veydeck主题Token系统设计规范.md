# Veydeck 主题 Token 系统设计规范

本文档定义 Veydeck Design Language（VDL）的主题 Token 边界和使用规则。Token 的唯一源码位于 `veydeck-ui` 仓库的 `packages/tokens/`，通过 `@veydeck/tokens` 发布。消费项目不得复制或维护另一份公共 Token。

## 1. 设计原则

- 工程化：结构清晰、状态明确、操作可预测。
- 控制面气质：适合节点、任务、资源、日志和安全实验管理。
- 信息密度：优先可扫描性，不使用营销式页面构图。
- 浅色默认：主控默认使用浅色主题，同时完整支持深色主题。
- 克制表达：禁止卡通黑客元素、霓虹字符雨、装饰性光球和大面积高饱和渐变。

## 2. 事实来源与职责

| 内容 | 唯一来源 |
| --- | --- |
| 公共主题变量 | `@veydeck/tokens` |
| Vue 基础组件样式 | `@veydeck/vue/style.css` |
| React 基础组件样式 | `@veydeck/react/style.css` |
| 自有 SVG 图标 | `@veydeck/icons` |
| 主控专属资源变量 | 主控 `frontend/src/styles/theme.css` |

公共 Token 不得引用消费项目的图片、字体或其他静态资源路径。桌面壁纸等主控专属变量由主控自行定义。

## 3. 接入方式

```css
@import '@veydeck/tokens/index.css';
@import '@veydeck/vue/style.css';
```

React 项目将组件样式入口替换为 `@veydeck/react/style.css`。同一应用不得同时加载两套框架组件样式。

浅色主题通过根元素属性启用：

```html
<html data-theme="light">
```

深色主题使用 `data-theme="dark"` 或移除浅色覆盖。主控运行时默认写入 `data-theme="light"`。

Liquid Glass 默认开启，并通过根元素属性显式同步状态：

```html
<html data-theme="light" data-glass="enabled">
```

`data-glass="disabled"` 使用公共实色降级配方，关闭折射、模糊和材质高光。系统减少透明度、强制颜色等无障碍偏好同样必须得到清晰、稳定的降级表面。

## 4. Token 分类

- 背景：`--vdl-bg-*`
- 文本：`--vdl-text-*`
- 品牌：`--vdl-primary`、`--vdl-secondary`、`--vdl-accent`
- 状态：`--vdl-success`、`--vdl-warning`、`--vdl-danger`、`--vdl-info`
- 边框：`--vdl-border-*`
- 字体：`--vdl-font-*`
- 间距：`--vdl-space-*`
- 圆角：`--vdl-radius-*`
- 阴影：`--vdl-shadow-*`
- 层级：`--vdl-z-index-*`
- 玻璃材质：`--vdl-glass-*`，包含 surface、control、input 的 tint、边框、悬浮边框、阴影与光学参数

具体变量和值以已发布包及 `veydeck-ui/packages/tokens/index.css` 为准，本文档不重复维护完整数值表。

## 5. 使用规则

1. 业务组件优先使用现有 Token，不散落硬编码主题颜色。
2. 成功或在线使用 `success`，警告或排队使用 `warning`，失败或危险操作使用 `danger`，提示和通信状态使用 `info` 或 `primary`。
3. 日志、路径、命令、哈希、端口和 IP 使用等宽字体 Token。
4. 工具栏和紧凑表单通常使用 `--vdl-space-2` 或 `--vdl-space-3`；主内容区域通常使用 `--vdl-space-4`。
5. 消费项目需要新增公共变量时，应先在 `veydeck-ui` 中设计、发布，再升级依赖；不得只在单个项目中创建同名公共 Token。
6. 项目专属变量应保持明确边界，例如主控的 `--vdl-desktop-wallpaper`。

## 6. 组件约束

- Vue 业务 UI 优先使用 `@veydeck/vue`，React 业务 UI 优先使用 `@veydeck/react` 提供的 `Vey*` 组件。
- 不引入 Element Plus、Ant Design、Naive UI 等并行组件体系。
- 图标优先使用 `VeyIcon` 和 `@veydeck/icons`。
- 组件 Props、事件和类型声明以发布包 TypeScript 类型为准。
- 应用根节点使用对应框架的 `VeyGlassProvider` 同步材质状态；自绘框架表面使用 `VeyGlassSurface`，不得在业务项目中复制折射渲染器或公共光学参数。
- 玻璃表面内的文字、图标、表格单元格、终端、编辑器和 iframe 内容保持清晰，避免嵌套折射或对整个内容树应用滤镜。

## 7. 发布与升级

五个 UI 包独立维护版本。Token 发生变化时：

1. 更新并发布 `@veydeck/tokens`。
2. 如 `@veydeck/vue` 或 `@veydeck/react` 需要消费新版本，同步升级其精确依赖并发布对应框架包。
3. 消费项目使用精确版本升级依赖和锁文件。
4. 执行项目格式化、类型检查、Lint 和生产构建。
