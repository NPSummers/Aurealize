<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import { api, type AdminCard } from '../api';

type NDEFReaderConstructor = new () => {
  write: (message: string) => Promise<void>;
  makeReadOnly?: () => Promise<void>;
};

declare global {
  interface Window {
    NDEFReader?: NDEFReaderConstructor;
  }
}

const router = useRouter();
const email = ref('');
const loading = ref(true);
const saving = ref(false);
const nfcWriting = ref<'1' | '2' | null>(null);
const error = ref('');
const message = ref('');
const cards = ref<AdminCard[]>([]);
const cardId = ref('');
const link1 = ref('https://aurealize.aureal.dev');
const link2 = ref('https://aurealize.aureal.dev');
const wroteLink1 = ref(false);
const wroteLink2 = ref(false);
const lockedTag1 = ref(false);
const lockedTag2 = ref(false);

const nfcSupported = computed(() => Boolean(window.NDEFReader));
const canGenerate = computed(() => cardId.value.trim() && link1.value.trim() && link2.value.trim());

function cardPath(slot: 1 | 2) {
  return `${window.location.origin}/card_${cardId.value.trim()}_${slot}`;
}

async function load() {
  loading.value = true;
  error.value = '';
  const session = await api.session();
  if (!session.user) {
    router.replace('/');
    return;
  }
  if (!session.isAdmin) {
    router.replace('/app');
    return;
  }

  email.value = session.user.email;
  const result = await api.adminCards();
  cards.value = result.cards.filter((card) => !card.owner_id);
  cardId.value = result.nextId;
  loading.value = false;
}

async function writeNfc(slot: 1 | 2) {
  if (!window.NDEFReader) {
    error.value = 'NFC writing is not supported in this browser.';
    return;
  }

  error.value = '';
  message.value = `Hold the phone to NFC tag ${slot}.`;
  nfcWriting.value = String(slot) as '1' | '2';

  try {
    const writer = new (window as any).NDEFReader();
    await writer.write({ records: [{ recordType: 'url', data: cardPath(slot) }] });
    if (slot === 1) wroteLink1.value = true;
    if (slot === 2) wroteLink2.value = true;
    message.value = `Tag ${slot} was written.`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : `Could not write tag ${slot}.`;
  } finally {
    nfcWriting.value = null;
  }
}

async function lockNfc(slot: 1 | 2) {
  if (!window.NDEFReader) {
    error.value = 'NFC locking is not supported in this browser.';
    return;
  }

  error.value = '';
  message.value = `Hold the phone to NFC tag ${slot} to lock it.`;
  nfcWriting.value = String(slot) as '1' | '2';

  try {
    const writer = new window.NDEFReader();
    if (!writer.makeReadOnly) throw new Error('This browser does not support locking NFC tags.');
    await writer.makeReadOnly();
    if (slot === 1) lockedTag1.value = true;
    if (slot === 2) lockedTag2.value = true;
    message.value = `Tag ${slot} was locked.`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : `Could not lock tag ${slot}.`;
  } finally {
    nfcWriting.value = null;
  }
}

async function createCard() {
  saving.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api.adminCreateCard(cardId.value.trim(), link1.value.trim(), link2.value.trim());
    cards.value = [result.card, ...cards.value].filter((card) => !card.owner_id);
    const next = await api.adminNextCardId();
    cardId.value = next.nextId;
    wroteLink1.value = false;
    wroteLink2.value = false;
    lockedTag1.value = false;
    lockedTag2.value = false;
    message.value = 'Card saved. Claim QR is now available below.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not create card.';
  } finally {
    saving.value = false;
  }
}

async function logout() {
  await api.logout();
  router.replace('/');
}

onMounted(load);
</script>

<template>
  <AppShell active="admin" title="Card setup" subtitle="Prepare new cards, optional NFC tags, and claim QR codes." :is-admin="true">
    <section v-if="loading" class="skeleton-stack">
      <div class="skeleton-line wide"></div>
      <div class="skeleton-panel"></div>
    </section>

    <template v-else>
      <section class="admin-grid">
        <form class="panel admin-form" @submit.prevent="createCard">
          <div>
            <p class="eyebrow">New card</p>
            <h2>{{ cardId }}</h2>
            <p class="muted">Create the card first, then print or save the claim QR below. NFC writing is optional.</p>
          </div>

          <label>
            Card ID
            <input v-model="cardId" autocomplete="off" />
          </label>

          <label>
            Link 1 destination
            <input v-model="link1" inputmode="url" />
          </label>

          <label>
            Link 2 destination
            <input v-model="link2" inputmode="url" />
          </label>

          <div class="nfc-actions">
            <button class="secondary" type="button" :disabled="nfcWriting !== null" @click="writeNfc(1)">
              {{ nfcWriting === '1' ? 'Tap tag 1...' : wroteLink1 ? 'Tag 1 written' : 'Write tag 1' }}
            </button>
            <button class="secondary" type="button" :disabled="nfcWriting !== null" @click="writeNfc(2)">
              {{ nfcWriting === '2' ? 'Tap tag 2...' : wroteLink2 ? 'Tag 2 written' : 'Write tag 2' }}
            </button>
            <button class="secondary" type="button" :disabled="nfcWriting !== null" @click="lockNfc(1)">
              {{ nfcWriting === '1' ? 'Tap tag 1...' : lockedTag1 ? 'Tag 1 locked' : 'Lock tag 1' }}
            </button>
            <button class="secondary" type="button" :disabled="nfcWriting !== null" @click="lockNfc(2)">
              {{ nfcWriting === '2' ? 'Tap tag 2...' : lockedTag2 ? 'Tag 2 locked' : 'Lock tag 2' }}
            </button>
          </div>

          <p v-if="!nfcSupported" class="muted small-copy">Use Chrome on Android for NFC writing.</p>
          <p v-else class="muted small-copy">Write tags before generating if you are preparing NFC cards on this phone.</p>

          <button class="primary" :disabled="saving || !canGenerate">
            {{ saving ? 'Saving...' : 'Generate' }}
          </button>

          <p v-if="message" class="success">{{ message }}</p>
          <p v-if="error" class="error">{{ error }}</p>
        </form>

        <section class="panel admin-preview">
          <p class="eyebrow">NFC targets</p>
          <p class="muted">These are the URLs written to the physical tags.</p>
          <div>
            <span class="muted">Tag 1</span>
            <strong>{{ cardPath(1) }}</strong>
          </div>
          <div>
            <span class="muted">Tag 2</span>
            <strong>{{ cardPath(2) }}</strong>
          </div>
        </section>
      </section>

      <section class="admin-list">
        <article v-for="card in cards" :key="card.id" class="admin-card">
          <div>
            <p class="eyebrow">{{ card.owner_id ? 'Claimed' : 'Unclaimed' }}</p>
            <h2>{{ card.id }}</h2>
            <p class="muted">{{ card.claimUrl || 'Claim code not stored for this card.' }}</p>
          </div>
          <div v-if="!card.owner_id && card.qrSvg" class="qr-box" v-html="card.qrSvg"></div>
        </article>
      </section>
    </template>
  </AppShell>
</template>
