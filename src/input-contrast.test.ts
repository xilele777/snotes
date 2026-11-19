import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles.css', 'utf8')
function luminance(hex: string) {
  const channels = hex.match(/[\da-f]{2}/gi)!.map(part => {
    const channel = parseInt(part, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0]! + .05) / (values[1]! + .05)
}

describe('enabled input boundaries', () => {
  for (const [theme, selector] of [['light', ':root'], ['dark', '[data-theme="dark"]']]) {
    it(`${theme}: default, hover and focus contrast with input and adjacent surfaces is at least 3:1`, () => {
      const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0]!
      const token = (name: string) => block.match(new RegExp(`--${name}: (#[\\da-f]+);`))![1]!
      for (const boundary of ['border-input', 'text-tertiary', 'accent']) {
        for (const background of ['bg-surface', 'bg-app', 'bg-list']) {
          expect(contrast(token(boundary), token(background)), `${boundary} on ${background}`).toBeGreaterThanOrEqual(3)
        }
      }
    })
  }
})
