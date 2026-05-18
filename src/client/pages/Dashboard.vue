<script setup lang="ts">
import {
  FlexRender,
  createColumnHelper,
  getCoreRowModel,
  useVueTable
} from '@tanstack/vue-table';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import logoUrl from '../../aureallogo.svg';
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

async function logout() {
  await api.logout();
  router.replace('/');
}

onMounted(load);
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar-title">
        <img class="topbar-logo" :src="logoUrl" alt="Aurealize" />
        <h1>Card links</h1>
      </div>
      <div class="account">
        <RouterLink class="secondary compact" to="/settings">Settings</RouterLink>
        <RouterLink v-if="isAdmin" class="secondary compact" to="/admin">Admin</RouterLink>
        <button class="secondary compact" @click="logout">Log out</button>
      </div>
    </header>

    <section v-if="loading" class="panel status-panel">Loading cards...</section>
    <section v-else-if="error" class="panel status-panel error">{{ error }}</section>
    <section v-else-if="!hasCards" class="empty-state" v-motion-pop-visible>
      <h2>No cards claimed yet</h2>
      <p class="muted">Scan the QR code on an Aurealize card to attach it to this account.</p>
    </section>

    <section v-else class="table-panel" v-motion :initial="{ opacity: 0, y: 16 }" :enter="{ opacity: 1, y: 0 }">
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
  </main>
</template>
