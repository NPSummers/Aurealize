<script setup lang="ts">
import {
  FlexRender,
  createColumnHelper,
  getCoreRowModel,
  useVueTable
} from '@tanstack/vue-table';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import { api, type Card, type Connection } from '../api';

const router = useRouter();
const email = ref('');
const isAdmin = ref(false);
const loading = ref(true);
const error = ref('');
const cards = ref<Card[]>([]);
const connections = ref<Connection[]>([]);
const saving = reactive<Record<string, boolean>>({});
const forms = reactive<
  Record<
    string,
    {
      link1Kind: 'custom' | 'connection';
      link1Url: string;
      link1ConnectionId: string;
      link2Kind: 'custom' | 'connection';
      link2Url: string;
      link2ConnectionId: string;
      message: string;
      error: string;
    }
  >
>({});

const hasCards = computed(() => cards.value.length > 0);
const customLinkCount = computed(() =>
  cards.value.reduce((total, card) => total + (slotKind(card, 1) === 'custom' ? 1 : 0) + (slotKind(card, 2) === 'custom' ? 1 : 0), 0)
);
const columnHelper = createColumnHelper<Card>();

const columns = [
  columnHelper.accessor('id', {
    header: 'Card',
    cell: (info) => info.getValue()
  }),
  columnHelper.display({
    id: 'link1',
    header: 'Link 1',
    cell: () => ''
  }),
  columnHelper.display({
    id: 'link2',
    header: 'Link 2',
    cell: () => ''
  }),
  columnHelper.display({
    id: 'claimed',
    header: 'Claimed',
    cell: (info) => formatDate(info.row.original.claimed_at)
  }),
  columnHelper.display({
    id: 'status',
    header: 'Status',
    cell: (info) => forms[info.row.original.id]?.message || forms[info.row.original.id]?.error || 'Ready'
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: () => ''
  })
];

const table = useVueTable({
  get data() {
    return cards.value;
  },
  columns,
  getCoreRowModel: getCoreRowModel()
});

async function load() {
  loading.value = true;
  error.value = '';
  const session = await api.session();
  if (!session.user) {
    router.replace('/');
    return;
  }
  email.value = session.user.email;
  isAdmin.value = session.isAdmin;
  const [result, connectionResult] = await Promise.all([api.cards(), api.connections()]);
  cards.value = result.cards;
  connections.value = connectionResult.connections;
  for (const card of cards.value) {
    forms[card.id] = {
      link1Kind: card.link_1_kind ?? 'custom',
      link1Url: card.link_1_url ?? '',
      link1ConnectionId: card.link_1_connection_id ?? '',
      link2Kind: card.link_2_kind ?? 'custom',
      link2Url: card.link_2_url ?? '',
      link2ConnectionId: card.link_2_connection_id ?? '',
      message: '',
      error: ''
    };
  }
  loading.value = false;
}

async function save(card: Card) {
  const form = forms[card.id];
  saving[card.id] = true;
  form.error = '';
  form.message = '';
  try {
    const result = await api.updateCard(card.id, {
      link1Kind: form.link1Kind,
      link1Url: form.link1Url,
      link1ConnectionId: form.link1ConnectionId || null,
      link2Kind: form.link2Kind,
      link2Url: form.link2Url,
      link2ConnectionId: form.link2ConnectionId || null
    });
    Object.assign(card, result.card);
    form.message = 'Links saved.';
  } catch (cause) {
    form.error = cause instanceof Error ? cause.message : 'Could not save links.';
  } finally {
    saving[card.id] = false;
  }
}

function formatDate(value: string | null) {
  if (!value) return 'Not claimed';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function slotKind(card: Card, slot: 1 | 2) {
  return (slot === 1 ? card.link_1_kind : card.link_2_kind) ?? 'custom';
}

function selectedConnectionLabel(cardId: string, slot: 1 | 2) {
  const id = slot === 1 ? forms[cardId]?.link1ConnectionId : forms[cardId]?.link2ConnectionId;
  return connections.value.find((connection) => connection.id === id)?.label ?? 'Choose connection';
}

async function logout() {
  await api.logout();
  router.replace('/');
}

onMounted(load);
</script>

<template>
  <AppShell active="dashboard" title="Cards" subtitle="Manage where each card opens." :is-admin="isAdmin">
    <section v-if="loading" class="skeleton-stack">
      <div class="skeleton-line wide"></div>
      <div class="skeleton-panel"></div>
      <div class="skeleton-panel"></div>
    </section>
    <section v-else-if="error" class="alert error">
      <span>{{ error }}</span>
      <button class="secondary compact" @click="load">Retry</button>
    </section>
    <section v-else-if="!hasCards" class="empty-state" v-motion-pop-visible>
      <h2>No cards claimed yet</h2>
      <p class="muted">Open the claim link for a card to attach it to this account. Your cards will appear here.</p>
      <RouterLink class="secondary compact" to="/settings">Set up connections</RouterLink>
    </section>

    <template v-else>
      <section class="helper-panel" v-if="connections.length === 0">
        <div>
          <h2>Add connections first</h2>
          <p class="muted">Connections are trusted destinations like LinkedIn, X, and Email. Custom links still work, but visitors see a confirmation screen.</p>
        </div>
        <RouterLink class="secondary compact" to="/settings">Add connections</RouterLink>
      </section>

      <section class="dashboard-summary">
        <div>
          <strong>{{ cards.length }}</strong>
          <span class="muted">{{ cards.length === 1 ? 'card claimed' : 'cards claimed' }}</span>
        </div>
        <div>
          <strong>{{ connections.length }}</strong>
          <span class="muted">{{ connections.length === 1 ? 'connection' : 'connections' }}</span>
        </div>
        <div>
          <strong>{{ customLinkCount }}</strong>
          <span class="muted">custom links</span>
        </div>
      </section>

      <section class="mobile-card-list">
        <article v-for="card in cards" :key="card.id" class="mobile-card-editor">
          <div class="mobile-card-head">
            <div>
              <span class="muted">Card</span>
              <strong>{{ card.id }}</strong>
            </div>
            <span class="status-box">Claimed {{ formatDate(card.claimed_at) }}</span>
          </div>

          <div class="mobile-link-block">
            <div class="link-block-title">
              <h2>Link 1</h2>
              <span :class="['badge', forms[card.id].link1Kind === 'connection' ? 'trusted' : 'warning']">
                {{ forms[card.id].link1Kind === 'connection' ? 'Trusted' : 'Warning' }}
              </span>
            </div>
            <select v-model="forms[card.id].link1Kind" aria-label="Link 1 target type">
              <option value="connection">Connection</option>
              <option value="custom">Custom link</option>
            </select>
            <select v-if="forms[card.id].link1Kind === 'connection'" v-model="forms[card.id].link1ConnectionId" aria-label="Link 1 connection">
              <option value="">Choose connection</option>
              <option v-for="connection in connections" :key="connection.id" :value="connection.id">{{ connection.label }}</option>
            </select>
            <input v-else v-model="forms[card.id].link1Url" aria-label="Link 1 custom destination" placeholder="example.com/profile" />
          </div>

          <div class="mobile-link-block">
            <div class="link-block-title">
              <h2>Link 2</h2>
              <span :class="['badge', forms[card.id].link2Kind === 'connection' ? 'trusted' : 'warning']">
                {{ forms[card.id].link2Kind === 'connection' ? 'Trusted' : 'Warning' }}
              </span>
            </div>
            <select v-model="forms[card.id].link2Kind" aria-label="Link 2 target type">
              <option value="connection">Connection</option>
              <option value="custom">Custom link</option>
            </select>
            <select v-if="forms[card.id].link2Kind === 'connection'" v-model="forms[card.id].link2ConnectionId" aria-label="Link 2 connection">
              <option value="">Choose connection</option>
              <option v-for="connection in connections" :key="connection.id" :value="connection.id">{{ connection.label }}</option>
            </select>
            <input v-else v-model="forms[card.id].link2Url" aria-label="Link 2 custom destination" placeholder="example.com/shop" />
          </div>

          <div class="mobile-actions">
            <button class="primary" :disabled="saving[card.id]" @click="save(card)">
              {{ saving[card.id] ? 'Saving...' : 'Save changes' }}
            </button>
            <span v-if="forms[card.id].message" class="success">{{ forms[card.id].message }}</span>
            <span v-if="forms[card.id].error" class="error">{{ forms[card.id].error }}</span>
          </div>
        </article>
      </section>

    <section class="table-panel desktop-table" v-motion :initial="{ opacity: 0, y: 16 }" :enter="{ opacity: 1, y: 0 }">
      <div class="table-scroll">
        <table>
          <thead>
            <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
              <th v-for="header in headerGroup.headers" :key="header.id">
                <FlexRender
                  v-if="!header.isPlaceholder"
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in table.getRowModel().rows" :key="row.id">
              <td v-for="cell in row.getVisibleCells()" :key="cell.id" :class="`cell-${cell.column.id}`">
                <template v-if="cell.column.id === 'link1' || cell.column.id === 'link2'">
                  <div class="link-edit">
                    <div class="link-meta">
                      <span
                        :class="[
                          'badge',
                          (cell.column.id === 'link1' ? forms[row.original.id].link1Kind : forms[row.original.id].link2Kind) === 'connection'
                            ? 'trusted'
                            : 'warning'
                        ]"
                      >
                        {{
                          (cell.column.id === 'link1' ? forms[row.original.id].link1Kind : forms[row.original.id].link2Kind) === 'connection'
                            ? 'Trusted'
                            : 'Warning'
                        }}
                      </span>
                      <span class="muted">
                        {{
                          (cell.column.id === 'link1' ? forms[row.original.id].link1Kind : forms[row.original.id].link2Kind) === 'connection'
                            ? selectedConnectionLabel(row.original.id, cell.column.id === 'link1' ? 1 : 2)
                            : 'Custom link'
                        }}
                      </span>
                    </div>
                    <select
                      v-if="cell.column.id === 'link1'"
                      v-model="forms[row.original.id].link1Kind"
                      aria-label="Link 1 target type"
                    >
                      <option value="connection">Connection</option>
                      <option value="custom">Custom link</option>
                    </select>
                    <select v-else v-model="forms[row.original.id].link2Kind" aria-label="Link 2 target type">
                      <option value="connection">Connection</option>
                      <option value="custom">Custom link</option>
                    </select>

                    <select
                      v-if="cell.column.id === 'link1' && forms[row.original.id].link1Kind === 'connection'"
                      v-model="forms[row.original.id].link1ConnectionId"
                      aria-label="Link 1 connection"
                    >
                      <option value="">Choose connection</option>
                      <option v-for="connection in connections" :key="connection.id" :value="connection.id">
                        {{ connection.label }}
                      </option>
                    </select>
                    <select
                      v-else-if="cell.column.id === 'link2' && forms[row.original.id].link2Kind === 'connection'"
                      v-model="forms[row.original.id].link2ConnectionId"
                      aria-label="Link 2 connection"
                    >
                      <option value="">Choose connection</option>
                      <option v-for="connection in connections" :key="connection.id" :value="connection.id">
                        {{ connection.label }}
                      </option>
                    </select>

                    <input
                      v-else-if="cell.column.id === 'link1'"
                      v-model="forms[row.original.id].link1Url"
                      aria-label="Link 1 custom destination"
                      placeholder="https://example.com/profile"
                    />
                    <input
                      v-else
                      v-model="forms[row.original.id].link2Url"
                      aria-label="Link 2 custom destination"
                      placeholder="https://example.com/shop"
                    />
                  </div>
                </template>
                <template v-else-if="cell.column.id === 'status'">
                  <span
                    class="status-box"
                    :class="{
                      success: Boolean(forms[row.original.id].message),
                      error: Boolean(forms[row.original.id].error)
                    }"
                  >
                    <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                  </span>
                </template>
                <template v-else-if="cell.column.id === 'claimed'">
                  <span class="muted">
                    <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                  </span>
                </template>
                <template v-else-if="cell.column.id === 'actions'">
                  <button class="primary compact" :disabled="saving[row.original.id]" @click="save(row.original)">
                    {{ saving[row.original.id] ? 'Saving...' : 'Save' }}
                  </button>
                </template>
                <template v-else>
                  <strong class="card-id">
                    <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                  </strong>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    </template>
  </AppShell>
</template>
