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
  quota: {
    monthDays: 1,
    items: [
      { label: 'D1 行读取（当月）', used: 120, limit: 5_000_000, unit: '行' },
      { label: 'R2 存储', used: 2_000_000, limit: 1e10, unit: 'GB' },
    ],
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
const multi = {
  d1: {
    readsToday: 160, writesToday: 26, sqlToday: 126, avgMs: 9,
    trend: [
      { date: '2026-08-18', reads: 100, writes: 20, sql: 120, avgMs: 3 },
      { date: '2026-08-19', reads: 110, writes: 21, sql: 121, avgMs: 4 },
      { date: '2026-08-20', reads: 120, writes: 22, sql: 122, avgMs: 5 },
      { date: '2026-08-21', reads: 130, writes: 23, sql: 123, avgMs: 6 },
      { date: '2026-08-22', reads: 140, writes: 24, sql: 124, avgMs: 7 },
      { date: '2026-08-23', reads: 150, writes: 25, sql: 125, avgMs: 8 },
      { date: '2026-08-24', reads: 160, writes: 26, sql: 126, avgMs: 9 },
    ],
  },
  r2: {
    objects: 3, bytes: 2_000_000, classAToday: 11, classBToday: 8,
    trend: [
      { date: '2026-08-18', classA: 5, classB: 2 },
      { date: '2026-08-19', classA: 6, classB: 3 },
      { date: '2026-08-20', classA: 7, classB: 4 },
      { date: '2026-08-21', classA: 8, classB: 5 },
      { date: '2026-08-22', classA: 9, classB: 6 },
      { date: '2026-08-23', classA: 10, classB: 7 },
      { date: '2026-08-24', classA: 11, classB: 8 },
    ],
  },
  http: {
    requestsToday: 80,
    trend: [
      { date: '2026-08-18', requests: 50 },
      { date: '2026-08-19', requests: 55 },
      { date: '2026-08-20', requests: 60 },
      { date: '2026-08-21', requests: 65 },
      { date: '2026-08-22', requests: 70 },
      { date: '2026-08-23', requests: 75 },
      { date: '2026-08-24', requests: 80 },
    ],
  },
  quota: {
    monthDays: 7,
    items: [
      { label: 'R2 Class A（当月）', used: 56, limit: 1_000_000, unit: '次' },
    ],
  },
} as MetricsData

  it('多日趋势数据时渲染 7 天概览与趋势洞察', async () => {
    apiMetrics.mockResolvedValue({ ok: true, data: multi })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.metrics-overview').exists()).toBe(true)
    })

    expect(wrapper.find('.metrics-insights').exists()).toBe(true)
    expect(wrapper.text()).toContain('D1 读行数 · 7天')
    expect(wrapper.text()).toContain('HTTP 请求 · 7天')
    expect(wrapper.text()).toContain('vs 昨日')
    expect(wrapper.text()).toContain('7 天合计')
    wrapper.unmount()
  })

  const overData: MetricsData = {
    d1: null,
    r2: { objects: 1, bytes: 1, classAToday: 0, classBToday: 0, trend: [{ date: '2026-08-24', classA: 0, classB: 0 }] },
    http: { error: 'no_permission' } as any,
    quota: {
      monthDays: 7,
      items: [
        { label: 'R2 Class A（当月）', used: 1_500_000, limit: 1_000_000, unit: '次' as any },
        { label: 'R2 存储', used: 5e8, limit: 1e10, unit: 'GB' as any },
      ],
    },
  }

  it('额度用量渲染进度条且超费项标红告警', async () => {
    apiMetrics.mockResolvedValue({ ok: true, data: overData })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.metrics-quota').exists()).toBe(true)
    })

    expect(wrapper.text()).toContain('免费额度用量')
    expect(wrapper.text()).toContain('超费')
    expect(wrapper.text()).toContain('项已超费')
    expect(wrapper.find('.quota-item[data-status="over"]').exists()).toBe(true)
    expect(wrapper.find('.quota-fill').exists()).toBe(true)
    wrapper.unmount()
  })
})
