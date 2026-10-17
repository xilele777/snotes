<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { AgentActivity, AgentPermission, AgentTokenInfo } from '../../../shared/agent'
import { ApiError, apiFetch } from '../../api/client'
import ConfirmDialog from '../ConfirmDialog.vue'
import AppIcon from '../AppIcon.vue'
import SettingsHint from './SettingsHint.vue'

interface Notebook { id: string; name: string }
const tokens = ref<AgentTokenInfo[]>([])
const notebooks = ref<Notebook[]>([])
const activity = ref<AgentActivity[]>([])
const loading = ref(true)
const busy = ref(false)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const name = ref('')
const notebookIds = ref<string[]>([])
const permissions = ref<AgentPermission[]>(['read', 'create'])
const expiryDays = ref('30')
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
const canCreate = computed(() => loaded.value && name.value.trim() && notebookIds.value.length > 0 && permissions.value.length > 0 && !busy.value && !newSecret.value)
const notebookNames = (ids: string[]) => ids.map(id => notebooks.value.find(book => book.id === id)?.name ?? id).join('、')
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

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) {
    const code = (cause.data as { error?: string } | undefined)?.error
    if (code === 'invalid_notebooks') return '所选笔记本已变更，请刷新后重新选择。'
    if (cause.status === 404) return '服务端尚未提供 Agent 接入，请先升级服务端。'
  }
  return '请求失败，请检查网络和服务端是否已升级，然后重试。'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [credentials, operations] = await Promise.all([
      apiFetch<{ tokens: AgentTokenInfo[]; notebooks: Notebook[] }>('/api/agent-tokens', { cache: 'no-store' }),
      apiFetch<{ activity: AgentActivity[] }>('/api/agent-tokens/activity', { cache: 'no-store' }),
    ])
    tokens.value = credentials.tokens
    notebooks.value = credentials.notebooks
    activity.value = operations.activity
    notebookIds.value = notebookIds.value.filter(id => notebooks.value.some(book => book.id === id))
    loaded.value = true
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
onMounted(load)

async function createCredential() {
  if (!canCreate.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await apiFetch<{ token: string; credential: AgentTokenInfo }>('/api/agent-tokens', {
      method: 'POST', body: JSON.stringify({ name: name.value.trim(), notebook_ids: notebookIds.value, permissions: permissions.value,
        expires_at: expiryDays.value === 'never' ? null : Date.now() + Number(expiryDays.value) * 86_400_000 }),
    })
    newSecret.value = result.token
    tokens.value.unshift(result.credential)
    name.value = ''
    notice.value = '凭证已创建，请复制密钥或下方 MCP 配置。'
    await nextTick()
    secretField.value?.focus()
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function revokeCredential() {
  const target = revokeTarget.value
  if (!target || busy.value) return
  busy.value = true
  error.value = ''
  revokeTarget.value = null
  try {
    await apiFetch(`/api/agent-tokens/${target.id}`, { method: 'DELETE' })
    target.revoked_at = Date.now()
    // Do not keep a displayed secret for a credential that may now be revoked.
    newSecret.value = ''
    notice.value = `已撤销「${target.name}」。`
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}

async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); notice.value = '已复制。' }
  catch { notice.value = '未能自动复制，请选中文字后手动复制。' }
}
</script>

<template>
  <div class="agents-page">
    <p v-if="error" role="alert" class="agent-error">{{ error }}</p>
    <p v-if="notice" role="status" class="agent-notice">{{ notice }}</p>
    <p v-if="loading && !loaded" role="status" class="agent-description">正在加载凭证与笔记本…</p>

    <section v-if="newSecret" class="agent-secret" aria-labelledby="agent-secret-heading">
      <h2 id="agent-secret-heading">保存你的密钥</h2>
      <p>完整密钥仅在本次创建后显示，关闭或离开此页后无法再次查看。请妥善保管。</p>
      <textarea ref="secretField" aria-label="新建 Agent 密钥" :value="newSecret" readonly rows="2" spellcheck="false" />
      <div class="agent-actions"><button type="button" class="agent-button primary" @click="copy(newSecret)"><AppIcon name="copy" :size="15" />复制密钥</button><button type="button" class="agent-button" @click="newSecret = ''">已保存，关闭显示</button></div>
    </section>

    <section class="agent-section" aria-labelledby="agent-create-heading">
      <div class="agent-section-heading">
        <h2 id="agent-create-heading">创建凭证<SettingsHint id="agent-create-hint" label="创建凭证" text="每个 Agent 可使用独立凭证。所有凭证都能查看授权笔记本的目录和笔记标题，正文访问由下方权限控制。" /></h2>
        <button type="button" class="agent-button" :disabled="loading || busy" @click="load"><AppIcon name="refresh" :size="15" />刷新</button>
      </div>
      <p v-if="loaded && !notebooks.length" class="agent-empty">还没有可授权的笔记本。请先创建笔记本并完成同步，再刷新此页。</p>
      <form v-else class="agent-form" @submit.prevent="createCredential">
        <label class="agent-field">凭证名称<input v-model="name" name="agent-name" placeholder="例如：文档助手" maxlength="100" required :disabled="!loaded || busy" /></label>
        <fieldset :disabled="!loaded || busy"><legend>允许访问的笔记本</legend>
          <div class="agent-book-options"><label v-for="book in notebooks" :key="book.id" class="agent-option"><input v-model="notebookIds" type="checkbox" :value="book.id" name="agent-notebooks" /><span>{{ book.name }}</span></label></div>
        </fieldset>
        <fieldset :disabled="!loaded || busy"><legend>允许的操作</legend>
          <div class="agent-permissions">
            <div v-for="option in permissionOptions" :key="option.value" class="agent-permission-option">
              <label class="agent-option"><input v-model="permissions" type="checkbox" :value="option.value" name="agent-permissions" /><span>{{ option.label }}</span></label>
              <SettingsHint :id="`agent-permission-${option.value}-hint`" :label="option.label" :text="option.hint" />
            </div>
          </div>
        </fieldset>
        <label class="agent-field">有效期<select v-model="expiryDays" :disabled="!loaded || busy"><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="never">长期有效</option></select></label>
        <button type="submit" class="agent-button primary" :disabled="!canCreate || !!newSecret">{{ busy ? '正在处理…' : '创建凭证' }}</button>
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
      <div class="agent-section-heading"><h2 id="agent-tokens-heading">已有凭证<span v-if="loaded" class="agent-count">{{ tokens.length }}</span></h2></div>
      <p v-if="loaded && !tokens.length" class="agent-empty">还没有创建凭证。</p>
      <ul v-else class="agent-token-list">
        <li v-for="token in tokens" :key="token.id" class="agent-token-card" :class="tokenState(token)">
          <div class="agent-token-header">
            <span class="agent-token-icon"><AppIcon name="lock" :size="18" /></span>
            <div class="agent-token-identity"><strong>{{ token.name }}</strong><code>{{ token.prefix }}…</code></div>
            <span class="agent-badge" :class="tokenState(token)"><span class="agent-status-dot" />{{ tokenStatus(token) }}</span>
          </div>
          <dl class="agent-token-scope">
            <div><dt><AppIcon name="book" :size="14" />笔记本</dt><dd>{{ notebookNames(token.notebook_ids) }}</dd></div>
            <div><dt><AppIcon name="sliders" :size="14" />权限</dt><dd class="agent-scope-tags"><span v-for="option in permissionOptions.filter(option => token.permissions.includes(option.value))" :key="option.value" class="agent-scope-tag">{{ option.label }}</span></dd></div>
          </dl>
          <div class="agent-token-footer">
            <dl class="agent-token-times"><div><dt>最近使用</dt><dd>{{ formatTime(token.last_used_at) }}</dd></div><div><dt>到期时间</dt><dd>{{ token.expires_at === null ? '长期有效' : formatTime(token.expires_at) }}</dd></div></dl>
            <button v-if="token.revoked_at === null" type="button" class="agent-button danger" :aria-label="`撤销 ${token.name}`" :disabled="busy" @click="revokeTarget = token">撤销</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="agent-section" aria-labelledby="agent-activity-heading">
      <div class="agent-section-heading"><h2 id="agent-activity-heading">最近写入<span v-if="loaded" class="agent-count">{{ activity.length }}</span><SettingsHint id="agent-activity-hint" label="最近写入" text="显示最近 50 次成功写入，重复请求只计一次。" /></h2></div>
      <p v-if="loaded && !activity.length" class="agent-empty">还没有 Agent 写入记录。</p>
      <ol v-else class="agent-activity">
        <li v-for="item in activity" :key="`${item.token_id}:${item.operation_id}`">
          <span class="agent-activity-icon"><AppIcon :name="item.action === 'create_folder' ? 'folder' : item.action === 'create_note' ? 'note' : 'edit'" :size="16" /></span>
          <div class="agent-activity-content">
            <div class="agent-activity-title"><strong>{{ item.token_name }}</strong><span class="agent-action-badge">{{ actionNames[item.action] ?? item.action }}</span></div>
            <div class="agent-activity-meta"><span><AppIcon name="book" :size="13" />{{ notebookNames([item.notebook_id]) }}</span><time :datetime="new Date(item.created_at).toISOString()">{{ formatTime(item.created_at) }}</time></div>
            <details v-if="item.note_id" class="agent-activity-detail"><summary>笔记详情</summary><p>笔记 ID：<code>{{ item.note_id }}</code></p></details>
          </div>
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
.agent-count { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; min-height: 22px; box-sizing: border-box; margin-left: 5px; padding: 0 6px; border-radius: 6px; background: var(--bg-app); color: var(--text-secondary); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.agent-form { display: grid; gap: 18px; margin-top: 20px; }
.agent-field { display: grid; gap: 8px; font-size: 13px; }
.agent-field input, .agent-field select, .agent-secret textarea { width: 100%; box-sizing: border-box; min-height: 40px; padding: 9px 12px; border: 1px solid var(--border-default); border-radius: 7px; background: var(--bg-surface); color: var(--text-primary); font: inherit; }
.agent-field select { max-width: 220px; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 10px; font-size: 13px; }
.agent-book-options { display: flex; flex-wrap: wrap; gap: 10px 20px; max-height: 200px; overflow-y: auto; }
.agent-option { display: flex; align-items: center; gap: 8px; min-height: 32px; padding-block: 4px; color: var(--text-primary); font-size: 13px; overflow-wrap: anywhere; }
.agent-option input { flex: none; margin: 0; accent-color: var(--accent); }
.agent-permissions { position: relative; display: flex; flex-wrap: wrap; gap: 8px 24px; }
.agent-permission-option { display: flex; align-items: center; gap: 2px; }
.agent-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; width: fit-content; min-height: 36px; padding: 7px 12px; border: 1px solid var(--border-default); border-radius: 7px; background: var(--bg-surface); color: var(--text-primary); font-size: 13px; white-space: nowrap; }
.agent-button:hover:not(:disabled) { background: var(--bg-hover); }
.agent-button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.agent-button.danger { color: var(--danger); }
.agent-button.danger:hover:not(:disabled) { background: var(--danger-bg); border-color: var(--danger); }
.agent-button:disabled { opacity: .5; cursor: default; }
.agent-error { color: var(--danger); font-size: 13px; line-height: 1.8; }
.agent-notice { color: var(--accent); font-size: 13px; }
.agent-secret { margin-top: 20px; padding: 20px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-soft); }
.agent-secret p { font-size: 13px; line-height: 1.8; }
.agent-secret textarea { font-family: monospace; resize: vertical; overflow-wrap: anywhere; }
.agent-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.agent-endpoints { margin: 16px 0; padding: 12px 16px; border-radius: 8px; background: var(--bg-app); }
.agent-endpoints > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 12px; padding: 7px 0; font-size: 13px; }
.agent-endpoints dt { color: var(--text-secondary); }.agent-endpoints dd { margin: 0; }
.agent-endpoints code { overflow-wrap: anywhere; }
details summary { cursor: pointer; font-size: 13px; color: var(--accent); padding-block: 8px; }
pre { margin: 12px 0; padding: 16px; border-radius: 8px; background: var(--bg-app); font-size: 12px; line-height: 1.7; overflow-x: auto; }
.agent-empty { margin: 12px 0 0; padding: 16px; border-radius: 8px; color: var(--text-secondary); background: var(--bg-app); font-size: 13px; line-height: 1.8; }
.agent-token-list, .agent-activity { list-style: none; margin: 0; padding: 0; }
.agent-token-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.agent-token-card { min-width: 0; padding: 18px 20px 0; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-surface); }
.agent-token-card.active { border-left: 3px solid var(--accent); padding-left: 18px; }
.agent-token-card.revoked, .agent-token-card.expired { background: var(--bg-list); }
.agent-token-header { display: flex; align-items: center; gap: 12px; }
.agent-token-icon, .agent-activity-icon { display: flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }
.revoked .agent-token-icon, .expired .agent-token-icon { color: var(--text-tertiary); background: var(--bg-hover); }
.agent-token-identity { display: grid; flex: 1; min-width: 0; gap: 3px; }
.agent-token-identity strong, .agent-activity strong { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.agent-token-identity code { color: var(--text-tertiary); font-size: 12px; overflow-wrap: anywhere; }
.agent-badge { display: inline-flex; align-items: center; gap: 5px; flex: none; border-radius: 20px; padding: 3px 8px; background: var(--bg-hover); color: var(--text-secondary); font-size: 11px; }
.agent-badge.active { color: var(--accent); background: var(--accent-soft); }
.agent-badge.expired { color: var(--danger); background: var(--danger-bg); }
.agent-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.agent-token-scope { display: grid; gap: 12px; margin: 18px 0; font-size: 12px; }
.agent-token-scope > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); align-items: baseline; gap: 12px; }
.agent-token-scope dt { display: flex; align-items: center; gap: 6px; color: var(--text-tertiary); }
.agent-token-scope dd { margin: 0; color: var(--text-secondary); overflow-wrap: anywhere; }
.agent-scope-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.agent-scope-tag { padding: 1px 7px; border: 1px solid var(--border-light); border-radius: 5px; background: var(--bg-app); font-size: 11px; }
.agent-token-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--border-light); }
.agent-token-times { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0; font-size: 11px; }
.agent-token-times > div { display: grid; gap: 3px; }
.agent-token-times dt { color: var(--text-tertiary); }
.agent-token-times dd { margin: 0; color: var(--text-secondary); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.agent-token-footer .agent-button { flex: none; min-height: 30px; padding: 4px 10px; font-size: 12px; }
.agent-activity { border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-list); }
.agent-activity > li { display: flex; align-items: flex-start; gap: 12px; margin: 0 20px; padding: 18px 0; font-size: 13px; }
.agent-activity > li + li { border-top: 1px solid var(--border-light); }
.agent-activity-icon { width: 32px; height: 32px; border: 1px solid var(--border-light); border-radius: 50%; background: var(--bg-surface); color: var(--text-secondary); }
.agent-activity-content { flex: 1; min-width: 0; }
.agent-activity-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.agent-action-badge { border-radius: 5px; padding: 2px 7px; background: var(--accent-soft); color: var(--accent); font-size: 11px; }
.agent-activity-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 6px; color: var(--text-tertiary); font-size: 12px; }
.agent-activity-meta > span { display: flex; align-items: baseline; gap: 5px; overflow-wrap: anywhere; }
.agent-activity-meta .app-icon { flex: none; align-self: center; }
.agent-activity-meta time { font-size: 11px; font-variant-numeric: tabular-nums; }
.agent-activity-detail summary { width: fit-content; padding: 6px 0 0; color: var(--text-tertiary); font-size: 11px; }
.agent-activity-detail p { margin: 6px 0 0; color: var(--text-secondary); font-size: 11px; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .agent-secret { padding: 16px; }
  .agent-permissions { gap: 4px 12px; }
  .agent-endpoints > div { grid-template-columns: 1fr; gap: 4px; }
  .agent-token-card { padding: 16px 14px 0; }
  .agent-token-card.active { padding-left: 12px; }
  .agent-token-header { gap: 8px; }
  .agent-token-icon { width: 30px; height: 30px; border-radius: 8px; }
  .agent-token-scope > div { grid-template-columns: 62px minmax(0, 1fr); gap: 8px; }
  .agent-token-footer { align-items: flex-end; gap: 8px; }
  .agent-token-times { flex-direction: column; gap: 8px; }
  .agent-activity > li { margin-inline: 14px; gap: 10px; padding-block: 16px; }
}
</style>
