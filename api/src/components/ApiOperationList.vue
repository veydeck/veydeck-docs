<script setup lang="ts">
import { VeyEmpty, VeyIcon } from '@veydeck/vue'
import MethodBadge from './MethodBadge.vue'
import StatusBadge from './StatusBadge.vue'
import type { ApiOperation } from '@/models/api'

defineProps<{
  operations: ApiOperation[]
  selectedId?: string
}>()

defineEmits<{ select: [operation: ApiOperation] }>()
</script>

<template>
  <div class="operation-list" data-ui="operation-list">
    <button
      v-for="operation in operations"
      :key="operation.id"
      class="operation-row"
      :class="{ 'is-selected': operation.id === selectedId }"
      type="button"
      :data-operation-id="operation.id"
      @click="$emit('select', operation)"
    >
      <MethodBadge :method="operation.method" />
      <div class="operation-copy">
        <div class="operation-path">{{ operation.displayPath }}</div>
        <div class="operation-summary">{{ operation.summary }}</div>
      </div>
      <StatusBadge :status="operation.governance.implementationStatus" />
      <VeyIcon class="operation-chevron" name="chevron-right" :size="16" />
    </button>
    <VeyEmpty
      v-if="operations.length === 0"
      class="empty-state"
      description="没有符合当前筛选条件的接口。"
    />
  </div>
</template>
