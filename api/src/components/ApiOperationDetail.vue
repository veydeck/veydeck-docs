<script setup lang="ts">
import { VeyEmpty, VeyIcon } from '@veydeck/vue'
import { computed } from 'vue'
import MethodBadge from './MethodBadge.vue'
import StatusBadge from './StatusBadge.vue'
import { resolveLocalReference } from '@/services/catalog'
import type { ApiOperation } from '@/models/api'

const props = defineProps<{ operation?: ApiOperation }>()

const requestSchema = computed(() => {
  const content = (props.operation?.requestBody as Record<string, unknown> | undefined)?.content as
    | Record<string, { schema?: unknown }>
    | undefined
  const schema = content?.['application/json']?.schema
  return props.operation ? resolveLocalReference(props.operation.document, schema) : undefined
})

function responseValue(value: unknown): unknown {
  if (!props.operation) return value
  return resolveLocalReference(props.operation.document, value)
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <div v-if="operation" class="detail-panel" data-slot="operation-detail">
    <div class="detail-heading">
      <div class="detail-badges">
        <MethodBadge :method="operation.method" />
        <StatusBadge :status="operation.governance.implementationStatus" />
      </div>
      <div class="detail-title">{{ operation.summary }}</div>
      <div class="detail-path">{{ operation.displayPath }}</div>
      <div v-if="operation.description" class="detail-description">{{ operation.description }}</div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title"><VeyIcon name="shield-check" :size="16" />治理信息</div>
      <div class="detail-grid">
        <div>
          <span>项目</span><strong>{{ operation.projectName }}</strong>
        </div>
        <div>
          <span>服务</span><strong>{{ operation.serviceName }}</strong>
        </div>
        <div>
          <span>所有者</span><strong>{{ operation.governance.owner }}</strong>
        </div>
        <div>
          <span>生命周期</span><strong>{{ operation.governance.lifecycle }}</strong>
        </div>
        <div>
          <span>最近核对</span><strong>{{ operation.governance.reviewedAt || '尚未核对' }}</strong>
        </div>
        <div>
          <span>Operation ID</span><code>{{ operation.id }}</code>
        </div>
      </div>
      <div v-if="operation.governance.notes" class="governance-note">
        {{ operation.governance.notes }}
      </div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title"><VeyIcon name="code" :size="16" />请求契约</div>
      <div v-if="operation.parameters.length" class="code-label">Parameters</div>
      <pre v-if="operation.parameters.length">{{ pretty(operation.parameters) }}</pre>
      <div v-if="requestSchema" class="code-label">Request Body</div>
      <pre v-if="requestSchema">{{ pretty(requestSchema) }}</pre>
      <div v-if="!operation.parameters.length && !requestSchema" class="detail-muted">
        此接口没有登记参数或请求体。
      </div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title"><VeyIcon name="book-open" :size="16" />响应契约</div>
      <div v-for="(response, status) in operation.responses" :key="status" class="response-item">
        <div class="response-status">{{ status }}</div>
        <pre>{{ pretty(responseValue(response)) }}</pre>
      </div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title"><VeyIcon name="code" :size="16" />追溯</div>
      <div class="trace-row">
        <span>源码</span>
        <code
          >{{ operation.governance.source.repository }}/{{ operation.governance.source.file }}</code
        >
      </div>
      <div class="trace-row">
        <span>设计文档</span>
        <div v-if="operation.governance.designDocs.length" class="trace-docs">
          <code v-for="doc in operation.governance.designDocs" :key="doc">{{ doc }}</code>
        </div>
        <strong v-else>未关联</strong>
      </div>
    </div>
  </div>
  <VeyEmpty v-else class="detail-empty" description="选择一个接口查看契约详情。" />
</template>
