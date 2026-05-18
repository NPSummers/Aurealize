<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import LoginPanel from '../components/LoginPanel.vue';

const route = useRoute();
const router = useRouter();
const needsLogin = ref(false);
const error = ref('');
const claiming = ref(true);

async function claim() {
  const code = String(route.query.card ?? '');
  if (!code) {
    error.value = 'This claim link is missing its card code.';
    claiming.value = false;
    return;
  }
  localStorage.setItem('pendingClaimCode', code);

  const session = await api.session();
  if (!session.user) {
    needsLogin.value = true;
    claiming.value = false;
    return;
  }

  try {
    await api.claim(code);
    localStorage.removeItem('pendingClaimCode');
    router.replace('/app');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not claim this card.';
    claiming.value = false;
  }
}

onMounted(claim);
</script>

<template>
  <main class="shell centered">
    <section v-if="claiming" class="panel status-panel" v-motion-pop-visible>
      <p class="eyebrow">Card claim</p>
      <h1>Claiming your Aurealize card</h1>
      <p class="muted">This will attach the card to your account.</p>
    </section>

    <LoginPanel v-else-if="needsLogin" />

    <section v-else class="panel status-panel" v-motion-pop-visible>
      <p class="eyebrow">Card claim</p>
      <h1>Claim failed</h1>
      <p class="error">{{ error }}</p>
      <RouterLink class="secondary" to="/">Back to sign in</RouterLink>
    </section>
  </main>
</template>
