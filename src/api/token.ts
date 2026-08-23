import { ref } from 'vue'

const STORAGE_KEY = 'snotes_token'
/** 与 worker/auth.ts 的 IMAGE_COOKIE 必须同名 */
const COOKIE_NAME = 'snotes_token'

/** 抽出来是为了能在测试里直接断言属性，而不用去解析 document.cookie */
export function writeCookieHeader(token: string, maxAge = 31536000): string {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  return (
    `${COOKIE_NAME}=${encodeURIComponent(token)}` +
    `; Path=/api/images/; Max-Age=${maxAge}; SameSite=Strict${secure}`
  )
}

export const hasToken = ref(Boolean(localStorage.getItem(STORAGE_KEY)))

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
  document.cookie = writeCookieHeader(token)
  hasToken.value = true
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY)
  document.cookie = writeCookieHeader('', 0)
  hasToken.value = false
}
