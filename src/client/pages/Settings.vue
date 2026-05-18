<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import logoUrl from '../../aureallogo.svg';
import { api, type Connection } from '../api';

const router = useRouter();
const email = ref('');
const isAdmin = ref(false);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const message = ref('');
const connections = ref<Connection[]>([]);
const provider = ref<'LinkedIn' | 'X' | 'Email'>('LinkedIn');
const label = ref('LinkedIn');
const emailConnection = ref('');

const providers = ['LinkedIn', 'X', 'Email'] as const;

async function logout() {
  await api.logout();
  router.replace('/');
}

onMounted(async () => {
  const session = await api.session();
  if (!session.user) {
    router.replace('/');
    return;
  }

  email.value = session.user.email;
  isAdmin.value = session.isAdmin;
  const result = await api.connections();
  connections.value = result.connections;
  loading.value = false;
});

async function addConnection() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.createConnection(label.value, provider.value, emailConnection.value);
    connections.value = [...connections.value, result.connection];
    emailConnection.value = '';
    message.value = 'Connection saved.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save connection.';
  } finally {
    saving.value = false;
  }
}

async function removeConnection(id: string) {
  error.value = '';
  message.value = '';
  try {
    await api.deleteConnection(id);
    connections.value = connections.value.filter((connection) => connection.id !== id);
    message.value = 'Connection removed.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not remove connection.';
  }
}

function syncProvider() {
  label.value = provider.value;
  emailConnection.value = '';
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar-title">
        <img class="topbar-logo" :src="logoUrl" alt="Aurealize" />
        <h1>Settings</h1>
      </div>
      <div class="account">
        <RouterLink class="secondary compact" to="/app">Dashboard</RouterLink>
        <RouterLink v-if="isAdmin" class="secondary compact" to="/admin">Admin</RouterLink>
        <button class="secondary compact" @click="logout">Log out</button>
      </div>
    </header>

    <section v-if="loading" class="panel status-panel">Loading settings...</section>
    <section v-else class="settings-grid" v-motion-pop-visible>
      <form class="panel settings-form" @submit.prevent="addConnection">
        <div>
          <h2>Connections</h2>
          <p class="muted">Add trusted destinations. LinkedIn, X, and Email links skip the warning page.</p>
        </div>

        <label>
          Type
          <select v-model="provider" @change="syncProvider">
            <option v-for="item in providers" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>

        <label>
          Name
          <input v-model="label" required placeholder="LinkedIn" />
        </label>

        <label>
          {{ provider === 'Email' ? 'Email address' : 'Profile URL' }}
          <input
            v-model="emailConnection"
            required
            :inputmode="provider === 'Email' ? 'email' : 'url'"
            :placeholder="provider === 'Email' ? 'you@example.com' : provider === 'LinkedIn' ? 'linkedin.com/in/you' : 'x.com/you'"
          />
        </label>

        <button class="primary" :disabled="saving">{{ saving ? 'Saving...' : 'Add connection' }}</button>
        <p v-if="message" class="success">{{ message }}</p>
        <p v-if="error" class="error">{{ error }}</p>
      </form>

      <section class="connections-list">
        <article v-for="connection in connections" :key="connection.id" class="connection-card">
          <div>
            <p class="eyebrow">{{ connection.provider }}</p>
            <h2>{{ connection.label }}</h2>
            <p class="muted">{{ connection.url }}</p>
          </div>
          <button class="secondary compact" @click="removeConnection(connection.id)">Remove</button>
        </article>
        <article v-if="connections.length === 0" class="connection-card">
          <h2>No connections yet</h2>
          <p class="muted">Add LinkedIn, Facebook, a website, or any profile link.</p>
        </article>
      </section>
    </section>
  </main>
</template>
