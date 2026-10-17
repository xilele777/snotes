import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import AgentsPane from './AgentsPane.vue'
import { ApiError } from '../../api/client'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', async original => ({ ...(await original<typeof import('../../api/client')>()), apiFetch }))
const credential = { id: 'agent1', name: '研究助手', prefix: 'snt_abcd1234', notebook_ids: ['book1'], permissions: ['read', 'create'], created_at: 1, expires_at: null, revoked_at: null, last_used_at: null }
beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/activity')) return Promise.resolve({ activity: [] })
    if (init?.method === 'POST') return Promise.resolve({ token: 'snt_private_new_secret', credential })
    if (init?.method === 'DELETE') return Promise.resolve({ ok: true })
    return Promise.resolve({ tokens: [], notebooks: [{ id: 'book1', name: '项目资料' }] })
  })
})

it('requires an explicit notebook and permissions, displays a new secret once, and clears it on dismissal', async () => {
  const wrapper = mount(AgentsPane)
  await flushPromises()
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  await wrapper.get('input[name="agent-name"]').setValue('研究助手')
  await wrapper.get('input[name="agent-notebooks"]').setValue(true)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  const call = apiFetch.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(call[1].body)).toMatchObject({ name: '研究助手', notebook_ids: ['book1'], permissions: ['read', 'create'] })
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('snt_private_new_secret')
  expect(wrapper.get('pre').text()).toContain('Bearer snt_private_new_secret')
  expect(localStorage.getItem('snotes_agent_token')).toBeNull()
  const dismiss = wrapper.findAll('button').find(button => button.text().includes('已保存'))!
  await dismiss.trigger('click')
  expect(wrapper.find('textarea').exists()).toBe(false)
  expect(wrapper.get('pre').text()).toContain('YOUR_AGENT_TOKEN')
  expect(wrapper.text()).not.toContain('snt_private_new_secret')
  wrapper.unmount()
})

it('surfaces loading failures and prevents credential creation while disconnected', async () => {
  apiFetch.mockRejectedValue(new Error('offline'))
  const wrapper = mount(AgentsPane)
  await flushPromises()
  expect(wrapper.get('.agent-book-options [role="alert"]').text()).toContain('请检查网络')
  expect(wrapper.find('.agents-page > [role="alert"]').exists()).toBe(false)
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  const retry = wrapper.get('.agent-book-options button')
  expect(retry.element.matches(':disabled')).toBe(false)
  apiFetch.mockImplementation((path: string) => Promise.resolve(path.endsWith('/activity') ? { activity: [] } : {
    tokens: [], notebooks: [{ id: 'book1', name: '项目资料' }],
  }))
  await retry.trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.find('input[name="agent-notebooks"]').exists()).toBe(true)
  wrapper.unmount()
})

it('keeps credential management available when only activity fails', async () => {
  apiFetch.mockImplementation((path: string) => path.endsWith('/activity')
    ? Promise.reject(new ApiError(503, 'unavailable'))
    : Promise.resolve({ tokens: [credential], notebooks: [{ id: 'book1', name: '项目资料' }] }))
  const wrapper = mount(AgentsPane)
  await flushPromises()
  expect(wrapper.get('[aria-labelledby="agent-activity-heading"] [role="alert"]').text()).toContain('服务暂时不可用')
  expect(wrapper.get('.agent-token-list').text()).toContain('研究助手')
  await wrapper.get('input[name="agent-name"]').setValue('新助手')
  await wrapper.get('input[name="agent-notebooks"]').setValue(true)
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('requires a refresh to reconcile an uncertain credential creation instead of resubmitting it', async () => {
  const wrapper = mount(AgentsPane)
  await flushPromises()
  await wrapper.get('input[name="agent-name"]').setValue('研究助手')
  await wrapper.get('input[name="agent-notebooks"]').setValue(true)
  apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.get('.agent-submit-row [role="alert"]').text()).toContain('创建结果未确认')
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  await wrapper.get('.agent-submit-row [role="alert"] button').trigger('click')
  await flushPromises()
  expect(apiFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('offers server upgrade guidance only when the endpoint is unsupported', async () => {
  apiFetch.mockRejectedValue(new ApiError(404, 'not found'))
  const wrapper = mount(AgentsPane)
  await flushPromises()
  const failure = wrapper.get('.agent-book-options [role="alert"]')
  expect(failure.text()).toContain('服务端尚不支持 Agent 接入，请先升级')
  expect(failure.find('button').exists()).toBe(false)
  wrapper.unmount()
})

it('shows expired/revoked credentials and opens a confirmation before revocation', async () => {
  apiFetch.mockImplementation((path: string) => Promise.resolve(path.endsWith('/activity') ? { activity: [] } : {
    tokens: [{ ...credential }, { ...credential, id: 'old', name: '旧助手', revoked_at: 2 }, { ...credential, id: 'expired', name: '过期助手', expires_at: 1 }],
    notebooks: [{ id: 'book1', name: '项目资料' }],
  }))
  const wrapper = mount(AgentsPane, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  expect(wrapper.text()).toContain('已撤销')
  expect(wrapper.text()).toContain('已过期')
  await wrapper.get('[aria-label="撤销 研究助手"]').trigger('click')
  expect(wrapper.get('[role="alertdialog"]').text()).toContain('撤销 Agent 凭证')
  expect(apiFetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await wrapper.get('[role="alertdialog"] [data-op="confirm"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('.agent-token-card [role="alert"]').text()).toContain('撤销结果未确认')
  expect(wrapper.get('.agent-token-card .agent-badge').text()).toBe('有效')
  expect(wrapper.find('.agents-page > [role="alert"]').exists()).toBe(false)
  wrapper.unmount()
})
