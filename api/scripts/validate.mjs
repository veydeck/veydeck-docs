import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { validate } from '@scalar/openapi-parser'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']
const statuses = new Set(['unverified', 'verified', 'drifted', 'missing'])
const governanceFields = [
  'owner',
  'layer',
  'lifecycle',
  'implementationStatus',
  'source',
  'designDocs',
  'reviewedAt',
  'notes',
]
const errors = []
const operationIds = new Map()
const operations = new Map()

function fail(location, message) {
  errors.push(`${location}: ${message}`)
}

async function readYaml(relativePath) {
  const content = await readFile(resolve(root, relativePath), 'utf8')
  return { content, value: parse(content) }
}

function validateGovernance(extension, location) {
  if (!extension || typeof extension !== 'object') {
    fail(location, '缺少 x-veydeck 治理信息')
    return
  }
  for (const field of governanceFields) {
    if (!(field in extension)) fail(location, `x-veydeck 缺少字段 ${field}`)
  }
  if (!statuses.has(extension.implementationStatus)) {
    fail(location, `implementationStatus 无效：${extension.implementationStatus}`)
  }
  if (!extension.source?.repository || !extension.source?.file) {
    fail(location, 'x-veydeck.source 必须包含 repository 和 file')
  }
}

function validatePathParameters(path, operation, location) {
  const expected = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
  if (!expected.length) return
  const declared = (operation.parameters ?? [])
    .filter((parameter) => !('$ref' in parameter) && parameter.in === 'path')
    .map((parameter) => parameter.name)
  const hasReference = (operation.parameters ?? []).some((parameter) => '$ref' in parameter)
  if (hasReference) return
  for (const name of expected) {
    if (!declared.includes(name)) fail(location, `路径参数 {${name}} 未在 parameters 中声明`)
  }
}

const catalog = (await readYaml('catalog.yaml')).value
if (catalog?.version !== 1 || !Array.isArray(catalog.projects)) {
  fail('catalog.yaml', '必须包含 version: 1 和 projects 数组')
}

for (const project of catalog.projects ?? []) {
  if (!project.id || !project.name || !Array.isArray(project.services)) {
    fail(`catalog:${project.id ?? 'unknown'}`, '项目必须包含 id、name 和 services')
    continue
  }
  for (const service of project.services) {
    const serviceLocation = `${project.id}/${service.id}`
    if (!service.id || !service.name || !service.spec) {
      fail(serviceLocation, '服务必须包含 id、name 和 spec')
      continue
    }

    let content
    let document
    try {
      const loaded = await readYaml(service.spec)
      content = loaded.content
      document = loaded.value
    } catch (error) {
      fail(serviceLocation, `无法读取契约 ${service.spec}: ${error.message}`)
      continue
    }

    const result = await validate(content)
    if (!result.valid) {
      for (const error of result.errors ?? []) fail(service.spec, error.message)
    }

    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      for (const method of methods) {
        const operation = pathItem?.[method]
        if (!operation) continue
        const location = `${service.spec} ${method.toUpperCase()} ${path}`
        const operationId = operation.operationId

        if (!operationId) {
          fail(location, '缺少 operationId')
        } else if (operationIds.has(operationId)) {
          fail(location, `operationId 与 ${operationIds.get(operationId)} 重复`)
        } else {
          operationIds.set(operationId, location)
        }

        const operationKey = `${project.id}/${service.id}:${method.toUpperCase()} ${path}`
        if (operations.has(operationKey)) {
          fail(location, `方法与路径和 ${operations.get(operationKey)} 重复`)
        } else {
          operations.set(operationKey, location)
        }

        if (!operation.summary) fail(location, '缺少 summary')
        if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
          fail(location, '至少声明一个 tag')
        }
        if (!operation.responses || Object.keys(operation.responses).length === 0) {
          fail(location, '至少声明一个 response')
        }
        validateGovernance(operation['x-veydeck'], location)
        validatePathParameters(path, operation, location)
      }
    }
  }
}

if (errors.length) {
  console.error(`API 契约校验失败，共 ${errors.length} 项：`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`API 契约校验通过：${catalog.projects.length} 个项目，${operationIds.size} 个接口。`)
