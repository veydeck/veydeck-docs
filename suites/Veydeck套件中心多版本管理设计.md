# Veydeck 套件中心多版本管理设计

## 对象与归属

主控集中保存中心版本库，本地节点（`local`）和其他节点只维护各自部署实例。管理员可以从任意节点上下文上传 `.vsp`，包始终进入中心库，不自动安装到当前节点。

- `suite_catalog` 保存套件身份 `suite_id`。
- `suite_packages` 保存独立 `package_id`、版本、清单、文件快照及校验值，以 `(suite_id, version)` 唯一约束拒绝重复上传，内容相同也拒绝。数据库禁止更新版本包。
- `suite_instances` 绑定 `package_id`，复合外键保证套件和版本一致。每节点同一套件最多一个实例。
- `suite_install_tasks` 记录包身份、版本和校验值。实例与任务在同一个写事务中创建，任务恢复不能切换目标包。

套件列表按套件聚合版本，版本按导入时间倒序，时间相同时按包 ID 倒序。目录摘要取最近导入包的展示信息，实例详情和操作以绑定包为准；排序不表示版本高低。

## 接口与使用规则

- `POST /api/v1/suites/import`：上传包，返回 `packageId`、`suiteId`、`version`、`checksum`。
- `GET /api/v1/suites/list?nodeId=local`：返回全局套件及 `versions`，实例只返回目标节点的数据。
- `POST /api/v1/suites/{suite_id}/install`：必填 `nodeId`、`packageId`，可选 `adoptRetainedData`。用户必须明确选择版本，不默认安装最近版本。
- `DELETE /api/v1/suite-packages/{package_id}`：删除指定空闲版本。
- `DELETE /api/v1/suites/{suite_id}`：删除套件的全部空闲版本；存在任何占用则整体拒绝。最后一个版本删除后移除空套件身份。
- `GET /api/v1/suite-packages/{package_id}/assets/{asset_path}`：读取不可变包资源。
- 实例生命周期和实例资源 URL 保留原有形式，后端始终从实例绑定包生成入口、解析本地化和读取资源。

重复版本返回 HTTP 409 和 `SUITE_VERSION_ALREADY_EXISTS`；节点已安装返回 `SUITE_ALREADY_INSTALLED`；活跃安装冲突返回 `SUITE_OPERATION_BUSY`。删除被占用时返回 HTTP 409 和 `SUITE_RESOURCE_IN_USE`，`data` 包含 `packageId`、`version`、`nodeId`、`instanceId`、可空的 `taskId`。

任意状态实例以及未结束任务都阻止删除对应包。前端展示占用信息，后端通过写事务、实例外键和活跃任务删除触发器提供最终约束。已结束任务保留审计信息，不阻止删除；迟到进度不能重新激活已结束任务。

卸载只处理目标节点实例，不受其他节点引用相同版本影响。该实例仍有未结束安装任务时拒绝卸载。上传或删除空闲版本不会改变其他节点的运行内容。

Agent 安装结果和进度包含实例 ID、套件 ID、版本。主控校验其与持久化任务一致，避免恢复错误实例或错误版本的结果。

## 边界与未来升级

本轮保留现有 `.vsp` 格式，不调整协议仿真套件和规则库协议。当前处于 Alpha 阶段，直接重构初始表结构，不兼容旧数据、旧接口或旧 Agent。

本轮不执行在线升级或降级。未来升级任务应绑定源包和目标包，升级期间保护两者，成功后明确切换实例绑定；持久化数据回退需要套件提供备份、恢复或逆向迁移能力。是否零停机取决于套件的副本、健康检查、流量切换及数据迁移设计。
