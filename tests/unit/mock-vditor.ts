import { vi } from 'vitest'
import type Vditor from 'vditor'

/** Boundary fake; browser tests exercise Vditor's real parser and DOM. */
export class MockVditor {
  static instances: MockVditor[] = []
  value: string
  options: NonNullable<ConstructorParameters<typeof Vditor>[1]>
  constructor(public element: HTMLElement, options: NonNullable<ConstructorParameters<typeof Vditor>[1]>) {
    this.options = options
    this.value = options.value ?? ''
    MockVditor.instances.push(this)
    queueMicrotask(() => options.after?.())
  }
  getValue = vi.fn(() => this.value)
  setValue = vi.fn((value: string) => { this.value = value })
  getCurrentMode = vi.fn(() => this.options.mode ?? 'ir')
  insertMD = vi.fn((value: string) => { this.value += value; this.options.input?.(this.value) })
  focus = vi.fn()
  disabled = vi.fn()
  enable = vi.fn()
  destroy = vi.fn()
  setTheme = vi.fn()
  updateToolbarConfig = vi.fn()
  type(value: string) { this.value = value; this.options.input?.(value) }
}
