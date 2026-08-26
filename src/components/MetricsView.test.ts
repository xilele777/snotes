import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetricsData, QuotaItem } from '../../shared/types'
import MetricsView from './MetricsView.vue'

const apiMetrics = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  apiMetrics,
}))

const trend = [
  { date: '2026-08-23', reads: 4_000_000, writes: 20, requests: 50 },
  { date: '2026-08-24', reads: 1_200, writes: 30, requests: 60 },
]

function quotaItem(overrides: Partial<QuotaItem> = {}): QuotaItem {
  return {
    label: '测试额度',
    cycle: 'daily',
    used: 100,
    limit: 1_000,
    percent: 10,
    status: 'safe',
    secondaryLabel: '今日用量',
    secondaryValue: 100,
    explanation: '仍在免费额度内。',
    available: true,
    unit: '次',
    ...overrides,
  }
}

const data: MetricsData = {
  d1: {
    readsToday: 1_200,
    writesToday: 30,
    sqlToday: 150,
    avgMs: 4,
    trend,
  },
  r2: {
    objects: 3,
    bytes: 2_000_000,
    classAToday: 10,
    classBToday: 5,
    trend: [{ date: '2026-08-24', classA: 10, classB: 5 }],
  },
  workers: {
    requestsToday: 60,
    trend,
  },
  quota: {
    monthDays: 7,
    status: 'warning',
    overCount: 0,
    warningCount: 1,
    items: [
      quotaItem({
        label: 'D1 行读取 · 本月最高单日',
        used: 4_000_000,
        limit: 5_000_000,
        percent: 80,
        status: 'warning',
        secondaryValue: 1_200,
        peakDate: '2026-08-23',
        explanation: '已达到每日免费额度的 80%。',
        unit: '行',
      }),
      quotaItem({
        label: 'R2 Class A 操作 · 当月累计',
        cycle: 'monthly',
        used: 100,
        unit: '次',
      }),
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

    expect(wrapper.text()).toContain('正在读取 Cloudflare Analytics')
    wrapper.unmount()
  })

  it('优先展示免费额度总判定和逐项依据', async () => {
    apiMetrics.mockResolvedValue({ ok: true, data })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.quota-hero').exists()).toBe(true)
    })

    expect(wrapper.find('.quota-hero').attributes('data-status')).toBe('warning')
    expect(wrapper.text()).toContain('接近免费额度')
    expect(wrapper.text()).toContain('D1 行读取 · 本月最高单日')
    expect(wrapper.text()).toContain('4,000,000 / 5,000,000')
    expect(wrapper.text()).toContain('今日用量')
    expect(wrapper.find('[data-status="warning"] .quota-warning-mark').exists()).toBe(true)
    wrapper.unmount()
  })

  it('任一额度超过 100% 时整页判定为已超出', async () => {
    const over: MetricsData = {
      ...data,
      quota: {
        monthDays: 7,
        status: 'over',
        overCount: 1,
        warningCount: 0,
        items: [
          quotaItem({
            label: 'Workers 请求 · 本月最高单日',
            used: 120_000,
            limit: 100_000,
            percent: 120,
            status: 'over',
            secondaryLabel: '今日用量',
            secondaryValue: 60,
            peakDate: '2026-08-23',
            explanation: '本月已有单日超过每日免费额度。',
            unit: '请求',
          }),
        ],
      },
    }
    apiMetrics.mockResolvedValue({ ok: true, data: over })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.quota-hero').exists()).toBe(true)
    })

    expect(wrapper.text()).toContain('已超出免费额度')
    expect(wrapper.text()).toContain('120%')
    expect(wrapper.find('.quota-card[data-status="over"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('查询失败时显示无法判断，而不是伪装成安全', async () => {
    const unavailable: MetricsData = {
      ...data,
      quota: {
        monthDays: 7,
        status: 'unavailable',
        overCount: 0,
        warningCount: 0,
        items: [
          quotaItem({
            label: 'R2 存储 · 当前快照',
            cycle: 'snapshot',
            status: 'unavailable',
            available: false,
            explanation: 'Analytics 查询失败或数据暂不可用，无法判断是否超额。',
          }),
        ],
      },
    }
    apiMetrics.mockResolvedValue({ ok: true, data: unavailable })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.quota-hero').exists()).toBe(true)
    })

    expect(wrapper.text()).toContain('部分额度无法确认')
    expect(wrapper.text()).toContain('无法判断是否超额')
    expect(wrapper.find('.quota-card[data-status="unavailable"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('近 7 天明细默认折叠为辅助信息', async () => {
    apiMetrics.mockResolvedValue({ ok: true, data })

    const wrapper = mount(MetricsView)
    await vi.waitFor(() => {
      expect(wrapper.find('.trend-panel').exists()).toBe(true)
    })

    expect(wrapper.find('.trend-panel').attributes('open')).toBeUndefined()
    expect(wrapper.text()).toContain('查看近 7 天明细')
    await wrapper.find('.trend-panel summary').trigger('click')
    expect(wrapper.text()).toContain('D1 · 每日读写行数')
    expect(wrapper.text()).toContain('Workers · 每日请求')
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
      expect(wrapper.find('.quota-hero').exists()).toBe(true)
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
