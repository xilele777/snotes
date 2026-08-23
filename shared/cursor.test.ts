import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from './cursor'

describe('cursor', () => {
  it('编码后可原样解码', () => {
    const c = encodeCursor(1_700_000_000_000, 'abc-def')
    expect(decodeCursor(c)).toEqual({ update_time: 1_700_000_000_000, id: 'abc-def' })
  })

  it('编码结果是 URL 安全的，不含 + / =', () => {
    const c = encodeCursor(1, 'a'.repeat(40))
    expect(c).not.toMatch(/[+/=]/)
  })

  it('id 含连字符与下划线也能往返', () => {
    expect(decodeCursor(encodeCursor(5, 'a_b-c'))).toEqual({ update_time: 5, id: 'a_b-c' })
  })

  it('非法游标返回 null 而不抛异常', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  it('结构不对的游标返回 null', () => {
    // 注意用 ASCII：btoa 对码位 > U+00FF 的字符直接抛 InvalidCharacterError，
    // 写成 btoa('没有冒号') 的话测试会在调用 decodeCursor 之前就炸掉。
    expect(decodeCursor(btoa('nocolon'))).toBeNull()
  })

  it('时间戳部分不是数字时返回 null', () => {
    expect(decodeCursor(btoa('abc:some-id'))).toBeNull()
  })
})
