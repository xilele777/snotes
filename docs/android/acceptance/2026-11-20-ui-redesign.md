# Android 体验改造验收

日期：2026-11-20。方案与实现范围见 [体验改造](../experience-redesign.md)。本记录对应本地内部构建，应用版本仍以根 `package.json` 为准。

本记录保留上一轮独立界面改造的测试与截图结果。用户随后明确以 Web 手机端作为 Android 页面逻辑与布局基准；新的实现与验证见 [Web 对齐验收](2026-11-20-web-alignment.md)，本记录不能作为两端已经对齐的证明。

## 自动化

| 检查 | 结果 |
| --- | --- |
| Android JVM 单元测试 | 87 项通过 |
| Android debug APK / androidTest APK | 构建通过 |
| Android lintDebug | 0 errors；22 项现有依赖更新 / 工程建议类 warning，未禁用检查 |
| editor-web | 最终 10 项通过，覆盖原始 Markdown 保真、组合输入、旧 ACK、长文、格式工具选区、保存提示布局及强制颜色焦点回退 |
| Web / Worker / Node `npm run test:all` | 912 + 208 + 75 = 1,195 项通过 |
| 根 `npm run build` | 通过 |
| 模拟器 connectedDebugAndroidTest | 全套 75 项通过；导航、搜索页与焦点调整后 13 项 UI 复验通过；编辑器视觉收尾后 11 项编辑 / 离线流程再次通过 |

构建中遇到 lint 的 LeakDetector / Kotlin FIR 内部解析异常；将笔记本 ViewModel 与 UI 分文件后完成正常检查。随后修正日期的 `LocalLocale` 观察方式和组件 modifier 参数顺序。没有设置 lint baseline、关闭 detector 或降低错误级别。

现有测试入口随导航改造更新：原型与应用版本从设置末尾访问，回收站从设置进入；懒加载列表通过容器 `performScrollToNode` 滚动到目标。页面截图使用 Compose `captureToImage`，避免与 CLI 的 UiAutomation 服务冲突。

## 当前模拟器与界面核对

- 模拟器：`emulator-5580`，Pixel_9a AVD，Android 16。
- 原始窗口：1080×2424 px，420 dpi；compile / target SDK 配置沿用项目固定值。
- [首页与编辑器前后对比](../../../artifacts/android/ux/comparison.png)。对比使用同一条内部验收笔记，截图保留本地设备时钟。
- 新编辑页正文区域起始位置从截图约 772 px 上移到约 379 px；底部格式工具单独占位，阅读时隐藏。这个观察是界面截图比较，不是性能或输入法验收结论。
- 首页筛选与引导属于滚动内容，滚动后只保留简洁顶栏；连接与维护操作不再固定占用笔记列表上方。
- 最终安装包的 [搜索与键盘](../../../artifacts/android/ux/final-search-keyboard.png) 已目视核对：搜索 FAB 已移除，输入框和筛选无遮挡。
- 最终安装包的 [编辑与键盘](../../../artifacts/android/ux/final-editor-keyboard.png) 已目视核对：格式工具位于键盘上方，正文聚焦只有细侧线，常规保存成功提示不再重复占用正文上方一行；警告 / 保存失败仍可见。
- [内部 debug APK](../../../artifacts/android/ux/snotes-ui-debug.apk) 已重新构建并安装到上述模拟器；保留 [13 项 UI 复验报告](../../../artifacts/android/ux/final-ui-tests.xml) 和 [最终 11 项编辑复验报告](../../../artifacts/android/ux/final-editor-tests.xml)。
- 本轮没有修改模拟器窗口或密度；宽窗口组件预览已添加，实际大屏窗口目视复核仍待进行。

## 后续人工门禁

当前自动测试已覆盖离线输入、中文 InputConnection、旋转恢复、预览 / IR 保真及本地同步规则。真机常用中文输入法、TalkBack、多种系统字号、折叠屏物理姿态和真机性能继续按 [人工清单](manual-checklist.md) 验收；本轮结果不替代这些门禁。

正式发布需按根 `AGENTS.md` 更新应用版本、CHANGELOG、提交、标签、生产部署与 GitHub Release。本轮仅交付源码、内部 debug APK 和本地界面验收产物。
