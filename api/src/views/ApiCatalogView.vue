<script setup lang="ts">
import { VeyGlassSurface, VeyIcon, VeyInput, VeySelect } from '@veydeck/vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ApiOperationDetail from '@/components/ApiOperationDetail.vue'
import ApiOperationList from '@/components/ApiOperationList.vue'
import { loadApiCatalog } from '@/services/catalog'
import type { ApiOperation, GovernanceStatus, HttpMethod } from '@/models/api'

const route = useRoute()
const router = useRouter()
const { catalog, operations } = loadApiCatalog()
const query = ref('')
const service = ref('all')
const method = ref<'all' | HttpMethod>('all')
const status = ref<'all' | GovernanceStatus>('all')

const methodOptions = [
  { value: 'all', label: '全部方法' },
  ...(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((value) => ({
    value,
    label: value,
  })),
]

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'unverified', label: '未核对' },
  { value: 'verified', label: '已核对' },
  { value: 'drifted', label: '存在偏移' },
  { value: 'missing', label: '缺少实现' },
]

const serviceOptions = computed(() =>
  catalog.projects.flatMap((project) =>
    project.services.map((item) => ({
      id: item.id,
      name: item.name,
      project: project.name,
      count: operations.filter((operation) => operation.serviceId === item.id).length,
    })),
  ),
)

const filteredOperations = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return operations.filter((operation) => {
    const matchesQuery =
      !keyword ||
      [
        operation.displayPath,
        operation.summary,
        operation.id,
        operation.tags.join(' '),
        operation.governance.notes,
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(keyword)
    return (
      matchesQuery &&
      (service.value === 'all' || operation.serviceId === service.value) &&
      (method.value === 'all' || operation.method === method.value) &&
      (status.value === 'all' || operation.governance.implementationStatus === status.value)
    )
  })
})

const selectedOperation = computed(() =>
  operations.find((operation) => operation.id === route.params.operationId),
)

const metrics = computed(() => ({
  total: operations.length,
  verified: operations.filter((item) => item.governance.implementationStatus === 'verified').length,
  unverified: operations.filter((item) => item.governance.implementationStatus === 'unverified')
    .length,
  attention: operations.filter((item) =>
    ['drifted', 'missing'].includes(item.governance.implementationStatus),
  ).length,
}))

function selectOperation(operation: ApiOperation) {
  void router.replace({ name: 'operation', params: { operationId: operation.id } })
}

watch(
  filteredOperations,
  (items) => {
    if (!selectedOperation.value && items[0]) selectOperation(items[0])
  },
  { immediate: true },
)
</script>

<template>
  <div class="catalog-page" data-page="api-catalog">
    <div class="summary-strip" data-ui="summary">
      <VeyGlassSurface class="summary-item" profile="control">
        <VeyIcon name="workflow" :size="18" />
        <div>
          <strong>{{ metrics.total }}</strong
          ><span>已登记接口</span>
        </div>
      </VeyGlassSurface>
      <VeyGlassSurface class="summary-item is-success" profile="control">
        <VeyIcon name="success" :size="18" />
        <div>
          <strong>{{ metrics.verified }}</strong
          ><span>已核对</span>
        </div>
      </VeyGlassSurface>
      <VeyGlassSurface class="summary-item is-muted" profile="control">
        <VeyIcon name="file-question" :size="18" />
        <div>
          <strong>{{ metrics.unverified }}</strong
          ><span>等待核对</span>
        </div>
      </VeyGlassSurface>
      <VeyGlassSurface class="summary-item is-warning" profile="control">
        <VeyIcon name="warning" :size="18" />
        <div>
          <strong>{{ metrics.attention }}</strong
          ><span>需要处理</span>
        </div>
      </VeyGlassSurface>
    </div>

    <div class="filter-bar" data-ui="filters">
      <div class="search-field">
        <VeyIcon name="search" :size="16" />
        <VeyInput v-model="query" type="text" placeholder="搜索路径、摘要、Operation ID 或标签" />
      </div>
      <div class="filter-select">
        <VeySelect v-model="method" :options="methodOptions" placeholder="全部方法" />
      </div>
      <div class="filter-select">
        <VeySelect v-model="status" :options="statusOptions" placeholder="全部状态" />
      </div>
    </div>

    <div class="catalog-layout">
      <div class="service-sidebar" data-ui="service-navigation">
        <div class="sidebar-title">项目与服务</div>
        <button
          type="button"
          class="service-option"
          :class="{ 'is-selected': service === 'all' }"
          @click="service = 'all'"
        >
          <VeyIcon name="server" :size="16" /><span>全部服务</span
          ><strong>{{ operations.length }}</strong>
        </button>
        <button
          v-for="item in serviceOptions"
          :key="item.id"
          type="button"
          class="service-option"
          :class="{ 'is-selected': service === item.id }"
          @click="service = item.id"
        >
          <VeyIcon name="server" :size="16" />
          <span
            ><small>{{ item.project }}</small
            >{{ item.name }}</span
          >
          <strong>{{ item.count }}</strong>
        </button>
      </div>

      <div class="operation-column">
        <div class="column-heading">
          <span>接口目录</span>
          <strong>{{ filteredOperations.length }}</strong>
        </div>
        <ApiOperationList
          :operations="filteredOperations"
          :selected-id="selectedOperation?.id"
          @select="selectOperation"
        />
      </div>

      <div class="detail-column">
        <ApiOperationDetail :operation="selectedOperation" />
      </div>
    </div>
  </div>
</template>
