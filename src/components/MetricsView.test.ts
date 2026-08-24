import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetricsData } from '../../shared/types'
import MetricsView from './MetricsView.vue'

const apiMetrics = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiMetrics,
}))

const data: MetricsData = {
  d1: {
    readsToday: 120,
    writesToday: 30,
    sqlToday: 150,
    avgMs: 4,
    trend: [{ date: '2026-08-24', reads: 120, writes: 30, sql: 150, avgMs: 4 }],
  },
  r2: {
    objects: 3,
    bytes: 2_000_000,
    classAToday: 10,
    classBToday: 5,
    trend: [{ date: '2026-08-24', classA: 10, classB: 5 }],
  },
  http: {
    requestsToday: 60,
    trend: [{ date: '2026-08-24', requests: 60 }],
  },
}

beforeEach(() => {
  apiMetrics.mockReset()
})

describe('MetricsView', () => {
  it('请求未返回前显示加载提示', () => {
    apiMetrics.mockImplementation(() => new Promise(() => {}))

    const wrapper = mount(MetricsView)

    expect(wrapper.text()).toContain('加载中')
    wrapper.unmount()
  })

  it('成功响应渲染三张区块卡片与近 7 天趋势图', async () => {
    apiMetrics.mockResolvedValue({ ok: true, data })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.metric-cards').exists()).toBe(true)
    })

    expect(wrapper.text()).toContain('数据监控')
    expect(wrapper.text()).toContain('读行数')
    expect(wrapper.text()).toContain('120')
    expect(wrapper.text()).toContain('2.00 MB')
    expect(wrapper.find('.metric-charts').exists()).toBe(true)
    expect(wrapper.text()).toContain('D1 近 7 天 · 读 / 写行数')
    expect(wrapper.text()).toContain('R2 近 7 天 · Class A / B 操作数')
    expect(wrapper.text()).toContain('HTTP 近 7 天 · 请求量')
    wrapper.unmount()
  })

  it('HTTP 未配置 zone 时卡片显示无权限而非整页失败', async () => {
    apiMetrics.mockResolvedValue({ ok: true, data: { ...data, http: { error: 'no_permission' } } })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.metric-cards').exists()).toBe(true)
    })

    expect(wrapper.text()).toContain('无权限（未配置 CF_ZONE_ID）')
    expect(wrapper.find('.metrics-error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('接口返回 error 显示错误态，点重试能恢复', async () => {
    apiMetrics.mockResolvedValueOnce({ error: 'boom', message: '服务出错了' })
    apiMetrics.mockResolvedValue({ ok: true, data })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.metrics-error').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain('服务出错了')

    await wrapper.find('.metrics-retry').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('.metric-cards').exists()).toBe(true)
    })
    wrapper.unmount()
  })

  it('接口异常（reject）也进错误态', async () => {
    apiMetrics.mockRejectedValue(new Error('network down'))

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.metrics-error').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain('network down')
    wrapper.unmount()
  })
})
