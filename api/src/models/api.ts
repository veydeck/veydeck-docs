export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'TRACE'
export type GovernanceStatus = 'unverified' | 'verified' | 'drifted' | 'missing'

export interface Catalog {
  version: number
  projects: CatalogProject[]
}

export interface CatalogProject {
  id: string
  name: string
  description: string
  services: CatalogService[]
}

export interface CatalogService {
  id: string
  name: string
  description: string
  spec: string
  order: number
}

export interface GovernanceInfo {
  owner: string
  layer: string
  lifecycle: string
  implementationStatus: GovernanceStatus
  source: {
    repository: string
    file: string
  }
  designDocs: string[]
  reviewedAt: string | null
  notes: string
}

export interface ApiOperation {
  id: string
  projectId: string
  projectName: string
  serviceId: string
  serviceName: string
  method: HttpMethod
  path: string
  displayPath: string
  summary: string
  description: string
  tags: string[]
  deprecated: boolean
  security: unknown[]
  parameters: unknown[]
  requestBody?: unknown
  responses: Record<string, unknown>
  governance: GovernanceInfo
  document: OpenApiDocument
}

export interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: Record<string, unknown>
}

export interface OpenApiOperation {
  operationId: string
  summary: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  security?: unknown[]
  parameters?: unknown[]
  requestBody?: unknown
  responses: Record<string, unknown>
  'x-veydeck': GovernanceInfo
}
