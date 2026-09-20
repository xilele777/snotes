<script setup lang="ts">
import { computed, ref } from 'vue'
import { version as appVersion } from '../../../package.json'
import { clearToken } from '../../api/token'
import { closeOverlay } from '../../navigation'
import { RELEASES_URL, updateInfo } from '../../update-check'
import AppIcon from '../AppIcon.vue'
import ConfirmDialog from '../ConfirmDialog.vue'

/** 设置「关于」页：版本、更新与升级步骤、发布链接，页尾退出登录。内容自侧栏版本弹窗迁入。 */
const versionLabel = `v${appVersion}`
const isServerDeployment = import.meta.env.VITE_DEPLOY_TARGET === 'server'
const hasUpdate = computed(() => updateInfo.value?.hasUpdate === true)
const latestLabel = computed(() => (updateInfo.value ? `v${updateInfo.value.latest}` : null))
const releaseUrl = computed(() => hasUpdate.value ? updateInfo.value!.url : RELEASES_URL)

const confirmLogout = ref(false)

/** 只清令牌，不动 IndexedDB：本机已同步的笔记保留，重新输入令牌后照常使用 */
function runLogout() {
  confirmLogout.value = false
  closeOverlay()
  clearToken()
}
</script>

<template>
  <ul class="info-list">
    <li><span class="info-label">应用名称</span><span class="info-value">snotes</span></li>
    <li><span class="info-label">网页版本</span><span class="info-value">{{ versionLabel }}</span></li>
    <li v-if="hasUpdate" class="update-row">
      <span class="info-label">最新版本</span>
      <span class="info-value">{{ latestLabel }}</span>
      <span v-if="isServerDeployment" class="info-sub">备份数据后执行 <code>git pull --ff-only</code>。Docker 部署运行 <code>docker compose up -d --build</code>；直接使用 Node.js 时运行 <code>npm ci</code>、<code>npm run build:server</code>，再重启服务。数据库迁移在启动时自动执行。</span>
      <span v-else class="info-sub">先按 README 的升级步骤保留自己的部署配置，再依次执行 <code>git pull --ff-only</code>、<code>npm ci</code>、<code>npx wrangler d1 migrations apply snotes --remote</code>、<code>npm run deploy</code>。数据库改过名时替换 <code>snotes</code>。</span>
    </li>
    <li v-else-if="latestLabel"><span class="info-label">最新版本</span><span class="info-value">{{ latestLabel }}</span><span class="info-sub">已是最新</span></li>
  </ul>
  <p class="update-links"><a :href="releaseUrl" target="_blank" rel="noopener noreferrer">{{ hasUpdate ? '查看发布说明' : '查看全部版本' }}</a></p>

  <div class="about-footer">
    <button type="button" class="logout-button" data-action="logout" @click="confirmLogout = true">
      <AppIcon name="logout" :size="15" />退出登录
    </button>
  </div>

  <!-- 确认框 Teleport 到 body 末尾，落在设置弹窗之后，Esc 与 Tab 先由它接管 -->
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
