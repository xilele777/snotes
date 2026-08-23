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
