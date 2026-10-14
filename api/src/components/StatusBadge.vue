<script setup lang="ts">
import { VeyTag } from '@veydeck/vue'
import { computed } from 'vue'
import type { GovernanceStatus } from '@/models/api'

const props = defineProps<{ status: GovernanceStatus }>()

const labels: Record<GovernanceStatus, string> = {
  unverified: '未核对',
  verified: '已核对',
  drifted: '存在偏移',
  missing: '缺少实现',
}

const types = {
  unverified: 'default',
  verified: 'success',
  drifted: 'danger',
  missing: 'danger',
} as const

const label = computed(() => labels[props.status])
const type = computed(() => types[props.status])
</script>

<template>
  <VeyTag class="status-badge" :type="type">{{ label }}</VeyTag>
</template>
