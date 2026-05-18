<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const status = ref('Verifying your account...');
const failed = ref(false);

onMounted(async () => {
  const code = String(route.query.code ?? '');
  if (!code) {
    failed.value = true;
    status.value = 'Verification code is missing.';
    return;
  }

  try {
    const result = await api.verify(code);
    const pendingClaim = localStorage.getItem('pendingClaimCode');
    const next = pendingClaim ? `/claim?card=${encodeURIComponent(pendingClaim)}` : '/app';
    const shouldPromptPasskey = result.passkeyCount === 0 && !result.user.passkey_prompt_dismissed_at;
    router.replace(shouldPromptPasskey ? `/passkey-setup?next=${encodeURIComponent(next)}` : next);
  } catch (error) {
    failed.value = true;
    status.value = error instanceof Error ? error.message : 'Could not verify this link.';
  }
});
</script>

<template>
  <main class="shell centered">
    <section class="panel status-panel" v-motion-pop-visible>
      <p class="eyebrow">Email verification</p>
      <h1>{{ failed ? 'Link failed' : 'Almost done' }}</h1>
      <p :class="failed ? 'error' : 'muted'">{{ status }}</p>
      <RouterLink v-if="failed" class="secondary" to="/">Request a new link</RouterLink>
    </section>
  </main>
</template>
