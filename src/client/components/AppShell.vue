<script setup lang="ts">
import { useRouter } from 'vue-router';
import logoUrl from '../../aureallogo.svg';
import { api } from '../api';

const props = defineProps<{
  active: 'dashboard' | 'settings' | 'admin';
  isAdmin?: boolean;
  title: string;
  subtitle?: string;
}>();

const router = useRouter();

const navItems = [
  { id: 'dashboard', label: 'Dashboard', to: '/app' },
  { id: 'settings', label: 'Settings', to: '/settings' }
] as const;

async function logout() {
  await api.logout();
  router.replace('/');
}
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <RouterLink class="sidebar-brand" to="/app">
        <img :src="logoUrl" alt="Aurealize" />
        <span>Aurealize</span>
      </RouterLink>

      <nav class="sidebar-nav" aria-label="Main navigation">
        <RouterLink
          v-for="item in navItems"
          :key="item.id"
          :class="['nav-link', { active: props.active === item.id }]"
          :to="item.to"
        >
          {{ item.label }}
        </RouterLink>
        <RouterLink v-if="props.isAdmin" :class="['nav-link', { active: props.active === 'admin' }]" to="/admin">
          Admin
        </RouterLink>
      </nav>

      <button class="nav-link nav-button" @click="logout">Log out</button>
    </aside>

    <div class="content-shell">
      <header class="content-header">
        <div>
          <p class="breadcrumb">Aurealize / {{ props.title }}</p>
          <h1>{{ props.title }}</h1>
          <p v-if="props.subtitle" class="muted">{{ props.subtitle }}</p>
        </div>
        <slot name="actions" />
      </header>

      <main class="content-main">
        <slot />
      </main>
    </div>

    <nav class="mobile-nav" aria-label="Mobile navigation">
      <RouterLink
        v-for="item in navItems"
        :key="item.id"
        :class="['mobile-nav-link', { active: props.active === item.id }]"
        :to="item.to"
      >
        {{ item.label }}
      </RouterLink>
      <RouterLink v-if="props.isAdmin" :class="['mobile-nav-link', { active: props.active === 'admin' }]" to="/admin">
        Admin
      </RouterLink>
    </nav>
  </div>
</template>
