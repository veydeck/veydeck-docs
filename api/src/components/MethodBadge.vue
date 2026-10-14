<script setup lang="ts">
import type { HttpMethod } from '@/models/api'

defineProps<{ method: HttpMethod }>()
</script>

<template>
  <span class="method-badge" :class="`method-${method.toLowerCase()}`">{{ method }}</span>
</template>
