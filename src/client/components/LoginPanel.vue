<script setup lang="ts">
import { startAuthentication } from '@simplewebauthn/browser';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const emit = defineEmits<{ complete: [] }>();
const router = useRouter();
const email = ref('');
const loading = ref(false);
const passkeyLoading = ref(false);
const passkeyOptions = ref<unknown | null>(null);
const message = ref('');
const error = ref('');
const devLink = ref('');

async function requestEmail() {
  loading.value = true;
  error.value = '';
  message.value = '';
  devLink.value = '';
  passkeyOptions.value = null;
  try {
    const result = await api.requestLogin(email.value, 'register');
    message.value = 'Check your email for a verification link. It expires in 1 hour.';
    devLink.value = result.devVerificationUrl ?? '';
    emit('complete');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not send verification email.';
  } finally {
    loading.value = false;
  }
}

async function continueAuth() {
  loading.value = true;
  error.value = '';
  message.value = '';
  devLink.value = '';
  passkeyOptions.value = null;
  try {
    const result = await api.passkeyLoginOptions(email.value);
    passkeyOptions.value = result.options;
  } catch {
    await requestEmail();
  } finally {
    loading.value = false;
  }
}

async function signInWithPasskey() {
  passkeyLoading.value = true;
  error.value = '';
  message.value = '';
  devLink.value = '';
  try {
    const options = passkeyOptions.value ?? (await api.passkeyLoginOptions(email.value)).options;
    const response = await startAuthentication({ optionsJSON: options as never });
    await api.passkeyLoginVerify(response);
    const pendingClaim = localStorage.getItem('pendingClaimCode');
    router.replace(pendingClaim ? `/claim?card=${encodeURIComponent(pendingClaim)}` : '/app');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not sign in with passkey.';
  } finally {
    passkeyLoading.value = false;
  }
}

function cancelPasskey() {
  requestEmail();
}
</script>

<template>
  <form class="panel login-panel" @submit.prevent="continueAuth" v-motion-slide-visible-bottom>
    <div>
      <p class="eyebrow">Aurealize</p>
      <h1>Manage your card links</h1>
      <p class="muted">Sign in with email to manage the destinations connected to your cards.</p>
    </div>

    <label>
      Email
      <input v-model="email" required type="email" autocomplete="email" placeholder="you@example.com" />
    </label>

    <button class="primary" type="submit" :disabled="loading || passkeyLoading">
      {{ loading ? 'Checking account...' : 'Continue' }}
    </button>

    <div v-if="passkeyOptions" class="auth-choice" v-motion-pop-visible>
      <div>
        <h2>Use your passkey?</h2>
        <p class="muted">A passkey is available for this account. You can use it now or continue with email.</p>
      </div>
      <div class="button-row">
        <button class="primary" type="button" :disabled="passkeyLoading" @click="signInWithPasskey">
          {{ passkeyLoading ? 'Opening passkey...' : 'Use passkey' }}
        </button>
        <button class="secondary" type="button" :disabled="passkeyLoading || loading" @click="cancelPasskey">
          Use email instead
        </button>
      </div>
    </div>

    <p v-if="message" class="success">{{ message }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <a v-if="devLink" class="dev-link" :href="devLink">Open local dev verification link</a>
  </form>
</template>
