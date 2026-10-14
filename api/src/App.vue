<script setup lang="ts">
import { VeyGlassProvider, VeyGlassSurface, VeyIcon } from '@veydeck/vue'
</script>

<template>
  <VeyGlassProvider :glass="true">
    <div class="app-shell" data-page="api-governance">
      <VeyGlassSurface as="header" class="app-bar" data-ui="app-bar">
        <div class="brand">
          <div class="brand-mark"><VeyIcon name="braces" :size="19" /></div>
          <div>
            <div class="brand-name">Veydeck API</div>
            <div class="brand-caption">接口治理中心</div>
          </div>
        </div>
        <div class="app-meta">OpenAPI 3.1</div>
      </VeyGlassSurface>
      <RouterView />
    </div>
  </VeyGlassProvider>
</template>
