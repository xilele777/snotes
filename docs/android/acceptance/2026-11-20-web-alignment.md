# Android 与 Web 手机端对齐验收

日期：2026-11-20。对应 [跨端一致性基准](../experience-redesign.md#跨端一致性基准) 与本地 debug 构建；应用版本为根 `package.json` 的 `1.1.5`，未执行正式发布。

## 本轮结果

手机改为抽屉导航，入口按笔记、整理、工具组织；列表顶栏提供当前范围、数量和新建，下方提供搜索、排序与刷新。列表使用紧凑内容行与蓝色重点色，星标、置顶和隐藏状态保持可访问名称。宽窗口在 720 dp 起使用常驻侧栏。

随手记排除使用中笔记本的引用与隐藏内容；全部笔记、星标、分组与已隐藏分别使用对应范围。单篇显示设置可覆盖分组默认；已归档笔记本的引用可重新出现在随手记。搜索缺失正文提示按当前范围统计，三种排序都保留置顶优先。

设置按外观、数据、关于组织，统计与回收站独立访问。搜索和排序按视图恢复，工具页返回原工作区；笔记本章节内新建笔记使用事务同时保存正文、目录和任务，从编辑器返回原目录。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| Android JVM 单元测试 | 87 项通过 |
| editor-web 测试 | 10 项通过 |
| debug APK / androidTest APK | 构建通过 |
| lintDebug | 0 errors，22 项现有 warning；未关闭检查 |
| connectedDebugAndroidTest | 完整 81 项通过，0 failures / errors / skipped |
| WorkspaceExperienceTest | 包含查询重建恢复、工具页返回、抽屉系统返回、主题切换、章节新建与返回、横竖屏查询保留；截图通过 additionalTestOutputDir 留存 |
| git diff --check | 通过 |

验证命令：

```powershell
.\android\gradlew.bat -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
npm.cmd test --prefix android/editor-web
.\android\gradlew.bat -p android :app:lintDebug :app:connectedDebugAndroidTest --console plain --max-workers=2
```

本轮只修改 Android 原生代码与本地编辑器 CSS，未修改根 Web / Worker 运行代码。根 `test:all` 和 `build` 的上一轮结果保留在 [历史验收](2026-11-20-ui-redesign.md)，未当作本轮重新运行的结果。

## 截图与安装包

模拟器为 Pixel_9a，Android 16，1080×2424 px、420 dpi。Android 页面截图由 Compose captureToImage 获取，不包含系统栏绘制；横屏通过实际旋转触发，未修改模拟器密度。Web 使用独立浏览器上下文，412×876 CSS px；数据仅为本地验收夹具，后端请求被阻断。

[两端列表与抽屉对比](../../../artifacts/android/web-alignment/comparison.png)。Android 完整测试留下了其他验收笔记和分组，因此数量与 Web 单篇夹具不同；对比使用共同的样本内容核对层级与导航组织。

- [Android 列表](../../../artifacts/android/web-alignment/android-notes.png) 与 [Web 列表](../../../artifacts/android/web-alignment/web-notes.png)：使用同一段“周末的慢生活”内容核对标题、摘要、日期和状态层级。
- [Android 抽屉](../../../artifacts/android/web-alignment/android-drawer.png) 与 [Web 抽屉](../../../artifacts/android/web-alignment/web-drawer.png)：入口名称与顺序对应；Android 保留原生遮罩、触控尺寸与本机同步状态。
- [深色设置](../../../artifacts/android/web-alignment/android-settings-dark.png)、[数据设置](../../../artifacts/android/web-alignment/android-settings-data.png)、[统计](../../../artifacts/android/web-alignment/android-stats.png)、[回收站](../../../artifacts/android/web-alignment/android-trash.png)。
- [编辑器](../../../artifacts/android/web-alignment/android-editor.png)、[笔记本目录](../../../artifacts/android/web-alignment/android-book-directory.png)、[横屏工作区](../../../artifacts/android/web-alignment/android-wide-workspace.png)。
- [可安装的 debug APK](../../../artifacts/android/web-alignment/snotes-web-aligned-debug.apk)、[设备测试报告](../../../artifacts/android/web-alignment/connected-tests.xml)、[lint 报告](../../../artifacts/android/web-alignment/lint-results.xml)。
- 最终 APK 已安装到上述模拟器；[含系统栏的首页截图](../../../artifacts/android/web-alignment/android-installed-home.png) 目视确认了安全区与操作无遮挡。测试结束卸载清除了专用 debug 应用的夹具，重新安装后显示空白本机空间。

截图目视核对了导航组织、紧凑列表、蓝色重点色、设置分类、编辑工具位置及横屏侧栏。字体、触控尺寸、搜索框和系统返回采用原生交互；本记录不声称像素完全一致或 Web 全部能力已移植。

截图、测试报告与 APK 为已忽略的本地 `artifacts/android/` 产物。APK 供内部安装验收，未上传或部署。

APK SHA-256：`63625E8E90B3E061A445DD4390E67CD2F765C3A5E9A30B044E27BF3D81C7F239`。

## 保留差异与人工验收

Android 尚未实现 Web 快捷键与 Agent 凭证设置、完整字数 / 写作趋势 / 热力图统计、多选批量操作、多关键词匹配与正文高亮，以及笔记本固定偏好和完整创建位置选择器。编辑器即时渲染仍标为试用；源码与预览继续作为可用模式。

本轮自动化不替代真机中文输入法、TalkBack、大字号、折叠屏物理姿态和性能验收，仍沿用 [人工清单](manual-checklist.md)。正式上线时继续执行根 `AGENTS.md` 的版本、CHANGELOG、验证、提交、标签、部署与 GitHub Release 流程。
