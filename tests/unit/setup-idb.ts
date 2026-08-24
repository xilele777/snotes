import 'fake-indexeddb/auto'

// jsdom 不保证提供 crypto.randomUUID（各版本行为不一致），而 repo/stores 到处都在用它。
// 缺失时补一个仅供测试的实现，避免测试因环境差异随机爆炸。
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  const rand = () => Math.floor(Math.random() * 16).toString(16)
  Object.defineProperty(globalThis.crypto ?? (globalThis.crypto = {} as Crypto), 'randomUUID', {
    configurable: true,
    value: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) =>
        ch === 'x' ? rand() : ((Math.floor(Math.random() * 4) + 8).toString(16))
      ),
  })
}

// jsdom 不实现 window.matchMedia，而 isMobile()/窄屏分支要读它。
// jsdom 的固定视口是 1024×768，窄屏分支在单测里恒为 false——测试默认按桌面色走；
// 要测移动端路径时在具体用例里覆写 matchMedia 返回值即可。
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}
