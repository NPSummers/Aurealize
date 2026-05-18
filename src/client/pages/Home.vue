<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import logoUrl from '../../aureallogo.svg';
import { api } from '../api';
import LoginPanel from '../components/LoginPanel.vue';

const router = useRouter();

onMounted(async () => {
  const session = await api.session();
  if (session.user) router.replace('/app');
});
</script>

<template>
  <main class="shell split-shell">
    <section class="brand-copy" v-motion :initial="{ opacity: 0, y: 18 }" :enter="{ opacity: 1, y: 0 }">
      <img class="brand-logo" :src="logoUrl" alt="Aurealize" />
      <h2>Aurealize Cards</h2>
      <p>Keep your card current by updating the destinations connected to your Aurealize account anytime.</p>
    </section>
    <LoginPanel />
  </main>
</template>
