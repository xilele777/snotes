<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { AgentActivity, AgentPermission, AgentTokenInfo } from '../../../shared/agent'
import { ApiError, apiFetch } from '../../api/client'
import { notify } from '../../notify'
import ConfirmDialog from '../ConfirmDialog.vue'
import AppIcon from '../AppIcon.vue'
import ActionMenu from '../ActionMenu.vue'
import SettingsHint from './SettingsHint.vue'
import AgentFeedback from './AgentFeedback.vue'

interface Notebook { id: string; name: string }
interface Feedback { message: string; action?: string }
const tokens = ref<AgentTokenInfo[]>([])
const notebooks = ref<Notebook[]>([])
const activity = ref<AgentActivity[]>([])
const loading = ref(true)
const busy = ref(false)
const loaded = ref(false)
const activityLoaded = ref(false)
const loadError = ref<Feedback | null>(null)
const activityError = ref<Feedback | null>(null)
const createError = ref<Feedback | null>(null)
const revokeError = ref<(Feedback & { tokenId: string }) | null>(null)
const creationUncertain = ref(false)
const name = ref('')
const notebookIds = ref<string[]>([])
const permissions = ref<AgentPermission[]>(['read', 'create'])
const expiryDays = ref('30')
const expiryOpen = ref(false)
const expiryTrigger = ref<HTMLElement | null>(null)
const expiryOptions = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
  { value: 'never', label: '长期有效' },
]
const expiryLabel = computed(() => expiryOptions.find(option => option.value === expiryDays.value)?.label)
const newSecret = ref('')
const secretField = ref<HTMLTextAreaElement | null>(null)
const revokeTarget = ref<AgentTokenInfo | null>(null)
const permissionOptions: { value: AgentPermission; label: string; hint: string }[] = [
  { value: 'read', label: '读取', hint: '搜索和读取笔记正文' },
  { value: 'create', label: '新建', hint: '新建笔记与章节' },
  { value: 'update', label: '修改', hint: '替换正文或追加内容' },
]
const mcpUrl = `${location.origin}/api/mcp`
const apiUrl = `${location.origin}/api/agent/v1`
const configuration = computed(() => JSON.stringify({ mcpServers: { snotes: {
  url: mcpUrl, headers: { Authorization: `Bearer ${newSecret.value || 'YOUR_AGENT_TOKEN'}` },
} } }, null, 2))
const canCreate = computed(() => loaded.value && !loading.value && !loadError.value && !creationUncertain.value && name.value.trim() && notebookIds.value.length > 0 && permissions.value.length > 0 && !busy.value && !newSecret.value)
const notebookNames = (ids: string[]) => ids.map(id => notebooks.value.find(book => book.id === id)?.name ?? id).join('、')
const permissionNames = (values: AgentPermission[]) => permissionOptions.filter(option => values.includes(option.value)).map(option => option.label).join('、')
const formatTime = (time: number | null) => time === null ? '从未使用' : new Date(time).toLocaleString('zh-CN')
function tokenState(token: AgentTokenInfo) {
  if (token.revoked_at !== null) return 'revoked'
  if (token.expires_at !== null && token.expires_at <= Date.now()) return 'expired'
  return 'active'
}
function tokenStatus(token: AgentTokenInfo) {
  return { revoked: '已撤销', expired: '已过期', active: '有效' }[tokenState(token)]
}
const actionNames: Record<string, string> = { create_note: '新建笔记', create_folder: '新建章节', update_note: '修改笔记', append_note: '追加内容' }

function errorMessage(cause: unknown, operation: 'load' | 'create' | 'revoke' = 'load'): Feedback {
  if (cause instanceof ApiError) {
    const code = (cause.data as { error?: string } | undefined)?.error
    if (code === 'invalid_notebooks') return { message: '笔记本已变更，请刷新后重新选择。', action: '刷新' }
    if (code === 'invalid_expiry') return { message: '有效期已失效，请重新选择。' }
    if (cause.status === 400) return { message: '请检查凭证名称、笔记本和权限。' }
    if (cause.status === 404) return operation === 'revoke'
      ? { message: '凭证已不存在，请刷新列表。', action: '刷新' }
      : { message: '服务端尚不支持 Agent 接入，请先升级。' }
    if (cause.status === 403) return { message: '当前访问凭证没有管理权限。' }
    if (cause.status === 401) return { message: '登录已失效，请重新登录。' }
    if (cause.status === 429) return { message: '请求过于频繁，请稍后重试。', action: '重试' }
  }
  if (operation === 'create') return { message: '创建结果未确认，请先刷新凭证列表。', action: '刷新' }
  if (operation === 'revoke') return { message: '撤销结果未确认，请刷新查看状态。', action: '刷新' }
  if (cause instanceof ApiError) return { message: '服务暂时不可用，请稍后重试。', action: '重试' }
  if (cause instanceof Error && cause.name === 'AbortError') return { message: '请求超时，请重试。', action: '重试' }
  if (cause instanceof SyntaxError) return { message: '服务响应异常，请稍后重试。', action: '重试' }
  return { message: '无法连接服务，请检查网络。', action: '重试' }
}

async function load() {
  loading.value = true
  loadError.value = null
  activityError.value = null
  try {
    const [credentials, operations] = await Promise.allSettled([
      apiFetch<{ tokens: AgentTokenInfo[]; notebooks: Notebook[] }>('/api/agent-tokens', { cache: 'no-store' }),
      apiFetch<{ activity: AgentActivity[] }>('/api/agent-tokens/activity', { cache: 'no-store' }),
    ])
    if (credentials.status === 'fulfilled') {
      tokens.value = credentials.value.tokens
      notebooks.value = credentials.value.notebooks
      notebookIds.value = notebookIds.value.filter(id => notebooks.value.some(book => book.id === id))
      loaded.value = true
      createError.value = null
      creationUncertain.value = false
      revokeError.value = null
    } else { loadError.value = errorMessage(credentials.reason) }
    if (operations.status === 'fulfilled') {
      activity.value = operations.value.activity
      activityLoaded.value = true
    } else { activityError.value = errorMessage(operations.reason) }
  } catch (cause) { loadError.value = errorMessage(cause) }
  finally { loading.value = false }
}
onMounted(load)

async function createCredential() {
  if (!canCreate.value) return
  busy.value = true
  createError.value = null
  try {
    const result = await apiFetch<{ token: string; credential: AgentTokenInfo }>('/api/agent-tokens', {
      method: 'POST', body: JSON.stringify({ name: name.value.trim(), notebook_ids: notebookIds.value, permissions: permissions.value,
        expires_at: expiryDays.value === 'never' ? null : Date.now() + Number(expiryDays.value) * 86_400_000 }),
    })
    newSecret.value = result.token
    tokens.value.unshift(result.credential)
    name.value = ''
    notify('凭证已创建，请保存密钥。')
    await nextTick()
    secretField.value?.focus()
  } catch (cause) {
    createError.value = errorMessage(cause, 'create')
    creationUncertain.value = !(cause instanceof ApiError) || cause.status >= 500
  }
  finally { busy.value = false }
}

async function revokeCredential() {
  const target = revokeTarget.value
  if (!target || busy.value) return
  busy.value = true
  revokeError.value = null
  revokeTarget.value = null
  try {
    await apiFetch(`/api/agent-tokens/${target.id}`, { method: 'DELETE' })
    target.revoked_at = Date.now()
    // Do not keep a displayed secret for a credential that may now be revoked.
    newSecret.value = ''
    notify(`已撤销「${target.name}」。`)
  } catch (cause) { revokeError.value = { ...errorMessage(cause, 'revoke'), tokenId: target.id } }
  finally { busy.value = false }
}

async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); notify('已复制。') }
  catch { notify('未能自动复制，请选中文字后手动复制。') }
}
</script>

<template>
  <div class="agents-page">
    <section v-if="newSecret" class="agent-secret" aria-labelledby="agent-secret-heading">
      <h2 id="agent-secret-heading">保存你的密钥</h2>
      <p>完整密钥仅在本次创建后显示，关闭或离开此页后无法再次查看。请妥善保管。</p>
      <textarea ref="secretField" aria-label="新建 Agent 密钥" :value="newSecret" readonly rows="2" spellcheck="false" />
      <div class="agent-actions"><button type="button" class="agent-button primary" @click="copy(newSecret)"><AppIcon name="copy" :size="15" />复制密钥</button><button type="button" class="agent-button" @click="newSecret = ''">已保存，关闭显示</button></div>
    </section>

    <section class="agent-section" aria-labelledby="agent-create-heading">
      <div class="agent-section-heading">
        <h2 id="agent-create-heading">创建凭证<SettingsHint id="agent-create-hint" label="创建凭证" text="每个 Agent 可使用独立凭证。所有凭证都能查看授权笔记本的目录和笔记标题，正文访问由下方权限控制。" /></h2>
        <button type="button" class="agent-button agent-refresh" aria-label="刷新" :disabled="loading || busy" @click="load"><AppIcon name="refresh" :size="15" :class="{ 'is-loading': loading }" /><span role="status">{{ loading ? '加载中' : '刷新' }}</span></button>
      </div>
      <form class="agent-form" :aria-busy="loading" @submit.prevent="createCredential">
        <label class="agent-field">凭证名称<input v-model="name" name="agent-name" placeholder="例如：文档助手" maxlength="100" required :disabled="!loaded || busy" /></label>
        <fieldset :disabled="busy"><legend>允许访问的笔记本</legend>
          <div class="agent-book-options">
            <AgentFeedback v-if="loadError" :text="loadError.message" :action="loadError.action" :busy="loading" @retry="load" />
            <template v-else>
              <label v-for="book in notebooks" :key="book.id" class="agent-option"><input v-model="notebookIds" type="checkbox" :value="book.id" name="agent-notebooks" /><span>{{ book.name }}</span></label>
              <p v-if="loaded && !notebooks.length" class="agent-no-books">还没有可授权的笔记本。请先创建笔记本并完成同步，再刷新此页。</p>
            </template>
          </div>
        </fieldset>
        <fieldset :disabled="!loaded || busy"><legend>允许的操作</legend>
          <div class="agent-permissions">
            <div v-for="option in permissionOptions" :key="option.value" class="agent-permission-option">
              <label class="agent-option"><input v-model="permissions" type="checkbox" :value="option.value" name="agent-permissions" /><span>{{ option.label }}</span></label>
              <SettingsHint :id="`agent-permission-${option.value}-hint`" :label="option.label" :text="option.hint" />
            </div>
          </div>
        </fieldset>
        <div class="agent-field">
          <span>有效期</span>
          <button ref="expiryTrigger" type="button" class="agent-expiry-trigger" :aria-label="`有效期：${expiryLabel}`" aria-haspopup="menu" :aria-expanded="expiryOpen" :disabled="!loaded || busy" @click="expiryOpen = !expiryOpen" @keydown.down.prevent="expiryOpen = true" @keydown.up.prevent="expiryOpen = true">
            <span>{{ expiryLabel }}</span><AppIcon name="chevron" :size="14" class="agent-expiry-chevron" :class="{ expanded: expiryOpen }" />
          </button>
          <ActionMenu :open="expiryOpen" :anchor="expiryTrigger" label="有效期" focus-checked @close="expiryOpen = false">
            <button v-for="option in expiryOptions" :key="option.value" type="button" class="menu-item agent-expiry-option" role="menuitemradio" :aria-checked="expiryDays === option.value" @click="expiryDays = option.value; expiryOpen = false">
              <span>{{ option.label }}</span><AppIcon v-if="expiryDays === option.value" name="check" :size="14" class="menu-check" />
            </button>
          </ActionMenu>
        </div>
        <div class="agent-submit-row">
          <button type="submit" class="agent-button primary" :disabled="!canCreate || !!newSecret">{{ busy ? '正在处理…' : '创建凭证' }}</button>
          <AgentFeedback v-if="createError" :text="createError.message" :action="createError.action === '刷新' ? '刷新列表' : undefined" :busy="busy || loading" @retry="load" />
        </div>
        <p v-if="newSecret" class="agent-description">保存并关闭上方密钥后，可以继续创建凭证。</p>
      </form>
    </section>

    <section class="agent-section" aria-labelledby="agent-connect-heading">
      <div class="agent-section-heading"><h2 id="agent-connect-heading">连接 Agent<SettingsHint id="agent-connect-hint" label="连接 Agent" text="在支持远程 MCP（Streamable HTTP）和 Bearer 凭证的客户端中，填写以下地址与密钥。也可使用 HTTP API 接入脚本。" /></h2></div>
      <dl class="agent-endpoints"><div><dt>MCP 地址</dt><dd><code>{{ mcpUrl }}</code></dd></div><div><dt>HTTP API</dt><dd><code>{{ apiUrl }}</code></dd></div></dl>
      <details><summary>MCP 配置示例</summary><p class="agent-description">{{ newSecret ? '此配置包含刚创建的密钥，请作为私密配置保存。' : '将 YOUR_AGENT_TOKEN 替换为创建时保存的密钥。具体字段以客户端要求为准。' }}</p><pre>{{ configuration }}</pre><button type="button" class="agent-button" @click="copy(configuration)"><AppIcon name="copy" :size="15" />复制配置</button></details>
      <details><summary>使用建议</summary><p class="agent-description">连接后可以对 Agent 说：“把这份文档保存到项目资料笔记本的设计章节。” 修改已有文档时，需要同时授予读取和修改权限，便于处理版本冲突。</p></details>
    </section>

    <section class="agent-section" aria-labelledby="agent-tokens-heading">
      <div class="agent-section-heading"><h2 id="agent-tokens-heading">已有凭证<span class="agent-count">{{ loaded ? tokens.length : '—' }}</span></h2></div>
      <p v-if="loaded && !tokens.length" class="agent-empty">还没有创建凭证。</p>
      <ul v-else class="agent-token-list">
        <li v-for="token in tokens" :key="token.id" class="agent-token-card">
          <div class="agent-token-header">
            <div class="agent-token-title"><strong>{{ token.name }}</strong><span class="agent-badge">{{ tokenStatus(token) }}</span></div>
            <button v-if="token.revoked_at === null" type="button" class="agent-revoke" :aria-label="`撤销 ${token.name}`" :disabled="busy" @click="revokeTarget = token">撤销</button>
          </div>
          <div class="agent-token-meta"><code>{{ token.prefix }}…</code><span>{{ notebookNames(token.notebook_ids) }}</span><span>{{ permissionNames(token.permissions) }}</span></div>
          <dl class="agent-token-times"><div><dt>最近使用</dt><dd>{{ formatTime(token.last_used_at) }}</dd></div><div><dt>到期</dt><dd>{{ token.expires_at === null ? '长期有效' : formatTime(token.expires_at) }}</dd></div></dl>
          <AgentFeedback v-if="revokeError?.tokenId === token.id" :text="revokeError.message" :action="revokeError.action ? '刷新状态' : undefined" :busy="busy || loading" @retry="load" />
        </li>
      </ul>
    </section>

    <section class="agent-section" aria-labelledby="agent-activity-heading">
      <div class="agent-section-heading"><h2 id="agent-activity-heading">最近写入<span class="agent-count">{{ activityLoaded ? activity.length : '—' }}</span><SettingsHint id="agent-activity-hint" label="最近写入" text="显示最近 50 次成功写入，重复请求只计一次。" /></h2></div>
      <AgentFeedback v-if="activityError" :text="activityError.message" :action="activityError.action" :busy="loading || busy" @retry="load" />
      <p v-if="activityLoaded && !activity.length && !activityError" class="agent-empty">还没有 Agent 写入记录。</p>
      <ol v-else class="agent-activity">
        <li v-for="item in activity" :key="`${item.token_id}:${item.operation_id}`">
          <div class="agent-activity-description"><strong>{{ item.token_name }}</strong><span>{{ actionNames[item.action] ?? item.action }}</span><span class="agent-activity-book">{{ notebookNames([item.notebook_id]) }}</span></div>
          <time :datetime="new Date(item.created_at).toISOString()">{{ formatTime(item.created_at) }}</time>
        </li>
      </ol>
    </section>
  </div>
  <Teleport to="body"><ConfirmDialog :open="!!revokeTarget" title="撤销 Agent 凭证？" :message="`撤销后，使用「${revokeTarget?.name ?? ''}」的 Agent 将无法继续访问笔记本。`" confirm-text="撤销凭证" @confirm="revokeCredential" @cancel="revokeTarget = null" /></Teleport>
</template>

<style scoped>
.agent-description { margin: 8px 0 16px; color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.agent-section { padding: 24px 0; border-bottom: 1px solid var(--border-light); }
.agent-section:first-of-type { padding-top: 0; }
.agent-section:last-child { border-bottom: 0; }
.agents-page h2 { margin: 0; font-size: 15px; font-weight: 600; }
.agent-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.agent-section-heading h2 { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; gap: 4px; min-height: 26px; }
.agent-count { margin-left: 6px; color: var(--text-tertiary); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
.agent-form { display: grid; gap: 18px; margin-top: 20px; }
.agent-submit-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; }
.agent-field { display: grid; gap: 8px; font-size: 13px; }
.agent-field input, .agent-secret textarea { width: 100%; box-sizing: border-box; min-height: 40px; padding: 9px 12px; border: 1px solid var(--border-default); border-radius: 6px; background: var(--bg-surface); color: var(--text-primary); font: inherit; }
.agent-expiry-trigger { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 180px; max-width: 100%; min-height: 40px; padding: 9px 12px; border: 1px solid var(--border-default); border-radius: 6px; background: var(--bg-surface); color: var(--text-primary); font-size: 13px; text-align: left; }
.agent-expiry-trigger:hover:not(:disabled), .agent-expiry-trigger[aria-expanded='true'] { border-color: var(--border-input); background: var(--bg-hover); }
.agent-expiry-trigger:disabled { opacity: .5; cursor: default; }
.agent-expiry-chevron { color: var(--text-tertiary); transform: rotate(90deg); }
.agent-expiry-chevron.expanded { transform: rotate(-90deg); }
.agent-expiry-option { min-width: 164px; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 10px; font-size: 13px; }
.agent-book-options { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 20px; min-height: 40px; max-height: 200px; overflow-y: auto; }
.agent-no-books { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.agent-option { display: flex; align-items: center; gap: 8px; min-height: 32px; padding-block: 4px; color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
.agent-option input { flex: none; margin: 0; accent-color: var(--accent); }
.agent-permissions { position: relative; display: flex; flex-wrap: wrap; gap: 8px 24px; }
.agent-permission-option { display: flex; align-items: center; gap: 2px; }
.agent-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; width: fit-content; min-height: 36px; padding: 7px 12px; border: 1px solid var(--border-default); border-radius: 7px; background: var(--bg-surface); color: var(--text-primary); font-size: 13px; white-space: nowrap; }
.agent-button:hover:not(:disabled) { background: var(--bg-hover); }
.agent-button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.agent-button:disabled { opacity: .5; cursor: default; }
.agent-refresh { flex: none; width: 90px; }
.agent-refresh .is-loading { animation: agent-refresh 1s linear infinite; }
@keyframes agent-refresh { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .agent-refresh .is-loading { animation: none; } }
.agent-secret { margin-top: 20px; padding: 16px; border: 1px solid var(--border-default); border-radius: 6px; background: var(--bg-app); }
.agent-secret p { font-size: 13px; line-height: 1.8; }
.agent-secret textarea { font-family: monospace; resize: vertical; overflow-wrap: anywhere; }
.agent-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.agent-endpoints { margin: 16px 0; padding: 12px 16px; border-radius: 8px; background: var(--bg-app); }
.agent-endpoints > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 12px; padding: 7px 0; font-size: 13px; }
.agent-endpoints dt { color: var(--text-secondary); }.agent-endpoints dd { margin: 0; }
.agent-endpoints code { overflow-wrap: anywhere; }
details summary { cursor: pointer; font-size: 13px; color: var(--accent); padding-block: 8px; }
pre { margin: 12px 0; padding: 16px; border-radius: 8px; background: var(--bg-app); font-size: 12px; line-height: 1.7; overflow-x: auto; }
.agent-empty { margin: 0; padding: 8px 0; color: var(--text-tertiary); font-size: 13px; line-height: 1.8; }
.agent-token-list, .agent-activity { list-style: none; margin: 0; padding: 0; }
.agent-token-card { min-width: 0; padding: 12px 0; }
.agent-token-card + .agent-token-card { border-top: 1px solid var(--border-light); }
.agent-token-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.agent-token-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.agent-token-title strong, .agent-activity strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.agent-badge { flex: none; color: var(--text-tertiary); font-size: 12px; }
.agent-revoke { flex: none; min-height: 30px; padding: 4px 8px; margin-right: -8px; border: 0; border-radius: 4px; background: transparent; color: var(--text-secondary); font-size: 12px; }
.agent-revoke:hover:not(:disabled) { color: var(--danger); background: var(--bg-hover); }
.agent-revoke:disabled { opacity: .5; cursor: default; }
.agent-token-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.agent-token-meta code { color: var(--text-tertiary); font-size: 11px; }
.agent-token-times { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 6px 0 0; font-size: 11px; }
.agent-token-times > div { display: flex; flex-wrap: wrap; gap: 2px 6px; }
.agent-token-times dt, .agent-token-times dd { color: var(--text-tertiary); }
.agent-token-times dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.agent-activity > li { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 20px; padding: 12px 0; font-size: 13px; }
.agent-activity > li + li { border-top: 1px solid var(--border-light); }
.agent-activity-description { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; min-width: 0; color: var(--text-secondary); }
.agent-activity-description strong { color: var(--text-primary); }
.agent-activity-book { color: var(--text-tertiary); font-size: 12px; overflow-wrap: anywhere; }
.agent-activity time { color: var(--text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
@media (max-width: 480px) {
  .agent-permissions { gap: 4px 12px; }
  .agent-endpoints > div { grid-template-columns: 1fr; gap: 4px; }
  .agent-token-meta { gap: 4px 10px; }
  .agent-token-times { flex-direction: column; }
  .agent-activity-description { gap: 4px 8px; }
}
</style>
