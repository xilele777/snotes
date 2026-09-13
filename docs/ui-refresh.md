# 轻量便签界面调整

这次调整保留三栏便签结构，以更清晰的目录、更直接的操作和舒服的正文排版为主。使用系统字体、内联 SVG 和现有 Vue 组件，没有增加运行时依赖。

- 暖灰侧栏、纸张色选中态、统一图标与按钮；分组和低频入口分开摆放。
- 搜索移到列表上方，手机上直接可见。支持 Ctrl / Cmd + K、回车选择结果、清除筛选和方向键浏览。
- 新建按钮常驻，创建后直接输入。搜索或统计视图中新建也能立即看到新笔记。
- 编辑区增加专注模式，Esc 退出；字数、文档信息和格式提示放到底部。
- GFM 清单增加可操作的原生复选框，支持保存、撤销和重做，回收站中保持只读。
- 优化手机返回、侧栏关闭、左滑删除、中文输入法选词，以及弹窗焦点与 Esc 操作。

## 加载体积

生产构建中的首屏 JavaScript：

| | 调整前 | 调整后 |
| --- | ---: | ---: |
| 构建产物 | 约 692 KB | 约 233 KB |
| gzip | 约 220 KB | 约 81 KB |

编辑器、统计页和统计样式按需加载。这里比较的是首屏入口脚本；编辑器打开后会加载自己的模块。PWA 继续预缓存这些模块，保留离线使用能力。

## 本地验收

预览地址：<http://127.0.0.1:8787>，测试令牌为 `dev-token`。本次验收用的七条示例便签与三个分组保存在 `tmp/ui-preview-state`，读写经过真实的本地 Worker 和 IndexedDB。

重新启动预览：

```bash
npm run build
npx wrangler d1 migrations apply snotes-e2e --local --config tests/e2e/wrangler.jsonc --persist-to tmp/ui-preview-state
npx wrangler dev --local --config tests/e2e/wrangler.jsonc --persist-to tmp/ui-preview-state --port 8787 --ip 127.0.0.1
```

可依次体验搜索、新建直接输入、清单勾选、专注模式、分组、回收站；手机宽度下检查列表与编辑器切换。

## 验证

425 项前端与共享逻辑测试、123 项 Worker 集成测试、生产构建均通过。17 项端到端测试覆盖保存、图片上传、回收站、跨端同步、专注模式、清单和手机操作；最后的键盘调整已针对相关流程复测。

另外在独立浏览器中验证了 PWA 离线打开、离线勾选清单，以及刷新后内容保留。界面截图保存在本机 `tmp/ui-review`。

端到端测试使用独立的 `8790` 端口和 `tmp/e2e-state` 数据目录，启动时自动应用迁移。

```bash
npm run test:all
npm run build
npm run test:e2e
```
