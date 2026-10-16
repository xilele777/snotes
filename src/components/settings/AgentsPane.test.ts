import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import AgentsPane from './AgentsPane.vue'

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
  expect(wrapper.get('[role="alert"]').text()).toContain('请求失败')
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
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
  wrapper.unmount()
})
