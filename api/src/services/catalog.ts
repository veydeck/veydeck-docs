import { parse } from 'yaml'
import catalogSource from '../../catalog.yaml?raw'
import type {
  ApiOperation,
  Catalog,
  CatalogService,
  HttpMethod,
  OpenApiDocument,
} from '@/models/api'

const specSources = import.meta.glob('../../specs/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])

function sourceFor(service: CatalogService): string {
  const suffix = `../../${service.spec}`
  const match = Object.entries(specSources).find(([path]) => path.endsWith(suffix))
  if (!match) throw new Error(`未找到接口契约：${service.spec}`)
  return match[1]
}

/** 加载目录与全部 OpenAPI 契约，并转换为用于展示的扁平接口集合。 */
export function loadApiCatalog(): { catalog: Catalog; operations: ApiOperation[] } {
  const catalog = parse(catalogSource) as Catalog
  const operations: ApiOperation[] = []

  for (const project of catalog.projects) {
    for (const service of [...project.services].sort((a, b) => a.order - b.order)) {
      const document = parse(sourceFor(service)) as OpenApiDocument
      const basePath = document.servers?.[0]?.url?.replace(/\/$/, '') ?? ''
      for (const [path, pathItem] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          if (!methods.has(method)) continue
          operations.push({
            id: operation.operationId,
            projectId: project.id,
            projectName: project.name,
            serviceId: service.id,
            serviceName: service.name,
            method: method.toUpperCase() as HttpMethod,
            path,
            displayPath: `${basePath}${path}`,
            summary: operation.summary,
            description: operation.description ?? '',
            tags: operation.tags ?? [],
            deprecated: operation.deprecated ?? false,
            security: operation.security ?? [],
            parameters: operation.parameters ?? [],
            requestBody: operation.requestBody,
            responses: operation.responses,
            governance: operation['x-veydeck'],
            document,
          })
        }
      }
    }
  }

  return {
    catalog,
    operations: operations.sort((a, b) =>
      `${a.serviceName}${a.displayPath}${a.method}`.localeCompare(
        `${b.serviceName}${b.displayPath}${b.method}`,
        'zh-CN',
      ),
    ),
  }
}

/** 解析本地 JSON Pointer 引用，供契约详情展示。 */
export function resolveLocalReference(document: OpenApiDocument, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if ('$ref' in value && typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    return value.$ref
      .slice(2)
      .split('/')
      .reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object') return undefined
        return (current as Record<string, unknown>)[segment]
      }, document)
  }
  return value
}
