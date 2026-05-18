<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import logoUrl from '../../aureallogo.svg';

const route = useRoute();
const destination = computed(() => String(route.query.to ?? ''));
</script>

<template>
  <main class="shell centered">
    <section class="panel status-panel leaving-panel" v-motion-pop-visible>
      <img class="topbar-logo" :src="logoUrl" alt="Aurealize" />
      <h1>Are you sure you want to vist:</h1>
      <p class="destination-text">{{ destination }}</p>
      <a class="primary continue-link" :href="destination">Continue</a>
    </section>
  </main>
</template>
