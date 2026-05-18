import { MotionPlugin } from '@vueuse/motion';
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './styles.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/Home.vue') },
    { path: '/admin', component: () => import('./pages/Admin.vue') },
    { path: '/app', component: () => import('./pages/Dashboard.vue') },
    { path: '/claim', component: () => import('./pages/Claim.vue') },
    { path: '/leaving', component: () => import('./pages/Leaving.vue') },
    { path: '/passkey-setup', component: () => import('./pages/PasskeySetup.vue') },
    { path: '/settings', component: () => import('./pages/Settings.vue') },
    { path: '/verify', component: () => import('./pages/Verify.vue') }
  ]
});

createApp(App).use(router).use(MotionPlugin).mount('#app');
