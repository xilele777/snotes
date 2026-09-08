import { ref } from 'vue'

const STORAGE_KEY = 'snotes_token'
/** 与 worker/auth.ts 的 IMAGE_COOKIE 必须同名 */
const COOKIE_NAME = 'snotes_token'

/**
 * 抽出来是为了能在测试里直接断言属性，而不用去解析 document.cookie
 */
export function writeCookieHeader(token: string, maxAge = 31536000): string {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  return (
    `${COOKIE_NAME}=${encodeURIComponent(token)}` +
    `; Path=/api/images/; Max-Age=${maxAge}; SameSite=Strict${secure}`
  )
}

export const hasToken = ref(Boolean(localStorage.getItem(STORAGE_KEY)))

/**
 * Bug 1：运行期令牌失效（任意请求收到 401）时置上，TokenGate 据此说明
 * 「不是第一次使用、是令牌过期了」。setToken 成功时清掉，避免残留旧提示。
 */
export const authNotice = ref<string | null>(null)

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
  document.cookie = writeCookieHeader(token)
  hasToken.value = true
  authNotice.value = null
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY)
  document.cookie = writeCookieHeader('', 0)
  hasToken.value = false
}

export function markTokenInvalid(): void {
  authNotice.value = '令牌已失效，请重新输入访问令牌。'
}
