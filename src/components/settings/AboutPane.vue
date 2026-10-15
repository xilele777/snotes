<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { version as appVersion } from '../../../package.json'
import { clearToken } from '../../api/token'
import { apiFetch } from '../../api/client'
import { closeWorkspacePage } from '../../navigation'
import { RELEASES_URL, updateInfo } from '../../update-check'
import AppIcon from '../AppIcon.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import SettingsHint from './SettingsHint.vue'

/** 设置「关于」页：版本、更新与升级步骤、发布链接，页尾退出登录。内容自侧栏版本弹窗迁入。 */
const brandIconUrl = `${import.meta.env.BASE_URL}snotes.svg`
const versionLabel = `v${appVersion}`
const runtime = ref<'server' | 'cloudflare' | null>(null)
const detectingRuntime = ref(true)
const deploymentLabel = computed(() => runtime.value === 'server' ? 'Node.js 服务' : runtime.value === 'cloudflare' ? 'Cloudflare Worker' : detectingRuntime.value ? '正在识别…' : '暂未识别')
onMounted(async () => {
  try {
    const result = await apiFetch<{ runtime?: unknown }>('/api/runtime', { cache: 'no-store' })
    if (result.runtime === 'server' || result.runtime === 'cloudflare') runtime.value = result.runtime
  } catch { /* Older servers and offline sessions have no reliable runtime information. */ }
  finally { detectingRuntime.value = false }
})
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)
const latestLabel = computed(() => (updateInfo.value ? `v${updateInfo.value.latest}` : null))
const releaseUrl = computed(() => hasUpdate.value ? updateInfo.value!.url : RELEASES_URL)

const confirmLogout = ref(false)

/** 只清令牌，不动 IndexedDB：本机已同步的笔记保留，重新输入令牌后照常使用 */
function runLogout() {
  confirmLogout.value = false
  closeWorkspacePage()
  clearToken()
}
</script>

<template>
  <div class="about-page">
    <header class="about-identity">
      <img :src="brandIconUrl" alt="" width="56" height="56" />
      <div>
        <h2>snotes</h2>
        <p class="about-status" :class="{ 'has-update': hasUpdate }"><span class="about-version">{{ versionLabel }}</span><span>{{ hasUpdate ? '有新版本可用' : latestLabel ? '已是最新版本' : '当前运行版本' }}</span></p>
      </div>
    </header>

    <section class="about-section" aria-labelledby="about-version-heading">
      <div class="about-section-heading">
        <h3 id="about-version-heading">版本信息</h3>
        <a class="about-release-link" :href="releaseUrl" target="_blank" rel="noopener noreferrer">{{ hasUpdate ? '查看发布说明' : '查看全部版本' }}<AppIcon name="external" :size="14" /></a>
      </div>
      <dl class="about-details">
        <div><dt>网页版本</dt><dd>{{ versionLabel }}</dd></div>
        <div><dt>最新版本</dt><dd :class="{ 'has-update': hasUpdate }">{{ latestLabel ?? '暂未获取' }}</dd></div>
        <div><dt>部署方式</dt><dd data-runtime-label>{{ deploymentLabel }}</dd></div>
      </dl>
    </section>

    <section v-if="hasUpdate" class="about-section about-upgrade" aria-labelledby="about-upgrade-heading">
      <h3 id="about-upgrade-heading">更新指南</h3>
      <p class="about-description">更新前请先备份笔记，并按 README 的升级步骤保留自己的部署配置。</p>
      <div class="about-command"><h4>拉取最新代码</h4><code>git pull --ff-only</code></div>
      <template v-if="runtime === 'server'">
        <div class="about-command"><h4>Docker 部署</h4><code>docker compose up -d --build</code></div>
        <div class="about-command"><h4>直接运行 Node.js</h4><code>npm ci</code><code>npm run build:server</code><p>构建后重启服务，数据库迁移在启动时自动执行。</p></div>
      </template>
      <div v-else-if="runtime === 'cloudflare'" class="about-command"><h4>安装依赖并部署</h4><code>npm ci</code><code>npx wrangler d1 migrations apply snotes --remote</code><code>npm run deploy</code><p>数据库改过名时，将命令中的 snotes 替换为实际名称。</p></div>
      <p v-else class="about-description">{{ detectingRuntime ? '正在识别运行环境…' : '暂未识别运行环境，请按 README 选择对应部署方式的升级步骤。' }}</p>
    </section>

    <section class="about-session" aria-labelledby="about-session-heading">
      <h3 id="about-session-heading">登录状态<SettingsHint id="about-session-hint" label="登录状态" text="退出后，本机已同步的笔记会保留。" /></h3>
      <button type="button" class="logout-button" data-action="logout" @click="confirmLogout = true"><AppIcon name="logout" :size="15" />退出登录</button>
    </section>
  </div>

  <!-- 确认框在页面上方独立接管 Esc 与 Tab。 -->
  <Teleport to="body">
    <ConfirmDialog
      :open="confirmLogout"
      title="退出登录？"
      message="退出后需要重新输入访问令牌，本机已同步的笔记会保留。"
      confirm-text="退出"
      @confirm="runLogout"
      @cancel="confirmLogout = false"
    />
  </Teleport>
</template>

<style scoped>
.about-identity { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 8px 0 24px; text-align: center; }
.about-identity img { flex: none; width: 64px; height: 64px; }
.about-identity h2 { margin: 0 0 12px; font-size: 28px; font-weight: 650; letter-spacing: -.5px; line-height: 1.2; }
.about-status { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px; margin: 0; font-size: 13px; color: var(--text-secondary); }
.about-version { padding: 3px 9px; border-radius: 5px; background: var(--bg-app); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.has-update { color: var(--accent); }
.about-section { padding: 24px 0; }
.about-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.about-page h3 { margin: 0; font-size: 16px; font-weight: 600; }
.about-release-link { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 10px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-size: 13px; text-decoration: none; white-space: nowrap; }
.about-release-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.about-details { display: flex; flex-direction: column; margin: 0; padding: 4px 20px; border-radius: 10px; background: var(--bg-app); font-size: 14px; }
.about-details > div { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; padding: 14px 0; }
.about-details > div + div { border-top: 1px solid var(--border-light); }
.about-details dt { color: var(--text-secondary); }
.about-details dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.about-description { margin: 8px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.about-command { margin-top: 20px; }
.about-command h4 { margin: 0 0 8px; font-size: 13px; font-weight: 500; color: var(--text-secondary); }
.about-command code { display: block; padding: 10px 12px; background: var(--bg-app); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.about-command code:first-of-type { border-radius: 6px 6px 0 0; }
.about-command code:last-of-type { border-radius: 0 0 6px 6px; }
.about-command code:only-of-type { border-radius: 6px; }
.about-command code + code { padding-top: 0; }
.about-command p { margin: 8px 0 0; font-size: 12px; line-height: 1.8; color: var(--text-tertiary); }
.about-session { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 24px; margin-top: 8px; }
.about-session h3 { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
.about-session .logout-button { display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 14px; border: 1px solid var(--border-default); border-radius: 7px; background: var(--bg-surface); color: var(--text-secondary); font-size: 13px; }
.about-session .logout-button:hover { color: var(--danger); border-color: currentColor; background: var(--bg-hover); }
@media (max-width: 720px) {
  .about-identity { padding: 4px 0 16px; gap: 14px; }
  .about-identity img { width: 56px; height: 56px; }
  .about-identity h2 { font-size: 26px; }
  .about-details { padding-inline: 16px; }
  .about-section-heading { gap: 12px; }
}
</style>
