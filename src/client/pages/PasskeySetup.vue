<script setup lang="ts">
import { startRegistration } from '@simplewebauthn/browser';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const skipping = ref(false);
const error = ref('');

const nextPath = computed(() => {
  const next = String(route.query.next ?? '/app');
  return next.startsWith('/') ? next : '/app';
});

async function continueToNext() {
  await router.replace(nextPath.value);
}

async function createPasskey() {
  loading.value = true;
  error.value = '';
  try {
    const options = await api.passkeyRegisterOptions();
    const response = await startRegistration({ optionsJSON: options as never });
    await api.passkeyRegisterVerify(response);
    await continueToNext();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not create passkey.';
  } finally {
    loading.value = false;
  }
}

async function skip() {
  skipping.value = true;
  error.value = '';
  try {
    await api.passkeySkip();
    await continueToNext();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not skip passkey setup.';
  } finally {
    skipping.value = false;
  }
}
</script>

<template>
  <main class="shell centered">
    <section class="panel status-panel" v-motion-pop-visible>
      <p class="eyebrow">Account security</p>
      <h1>Add a passkey?</h1>
      <p class="muted">
        A passkey lets you sign in faster on this device. You can still use email verification whenever you prefer.
      </p>

      <div class="button-row">
        <button class="primary" :disabled="loading || skipping" @click="createPasskey">
          {{ loading ? 'Creating...' : 'Create passkey' }}
        </button>
        <button class="secondary" :disabled="loading || skipping" @click="skip">
          {{ skipping ? 'Skipping...' : 'Use email instead' }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>
