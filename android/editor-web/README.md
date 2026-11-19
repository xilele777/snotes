# Android 本地编辑页面

本目录仅负责输入、Markdown 预览和版本化消息，不连接服务端，不保存正文。原生宿主与保存会话在 `app/src/main/java/.../core/editor/` 和 `feature/editor/`。

## 构建

从仓库根目录执行：

```powershell
npm ci --prefix android/editor-web --no-audit --no-fund
npm --prefix android/editor-web run build
```

Gradle 自动安装本目录 lockfile 中的依赖并构建资源。Vditor 4.0.0 与根 package.json 保持一致，DOMPurify 3.4.18 为旧 WebView 的预览净化兜底。生成目录为 `android/app/build/generated/editorAssets/editor/`，通过 AGP Variant API 注册为 assets。生成结果不提交，构建只清理这一确定的目录。

Vditor / Lute / 中文语言 / 图标 / CSS / 许可证均来自锁定包，没有公网 CDN。assets.json 记录 Vditor 版本和 Lute SHA-256。

## 输入与资源边界

- 默认源码使用 HTML textarea，保留原稿、空行和历史 `<br />`，打开或预览不触发保存。
- 预览按需使用本地 Lute。原始 HTML 按共享规则降为文本；优先使用原生 setHTML，缺失时动态加载打包的 DOMPurify 并插入净化后的节点。预览勾选框只读。
- 50,000 字符以内可以手动进入 Vditor IR 试用；初始化规范化值与原稿基线分开，未编辑时切回源码仍得到原稿。长文不创建 IR DOM，预览按需生成。
- 源码 / IR 共用本次会话的有限撤销历史；换文档清空历史。组合输入期不切模式或执行格式动作。
- WebView 关闭 DOM 存储、文件访问和内容访问，Vditor cache.enable=false，不创建 IndexedDB 或 Service Worker。

Vditor 4.0.0 的 storage capability check 只检测 undefined，在关闭 DOM 存储的 WebView 上会错误读取 null。build.mjs 对该单点增加 null 检测，匹配失效即拒绝构建，并在 assets.json 记录补丁；不修改 node_modules。IR 重建补回已加载资源的 script ID，避免 Vditor 再次发起同步 XHR。

页面 CSP 与原生拦截共同限制资源：脚本与样式来自本地 origin，connect / frame / object / 表单提交关闭，原生拒绝所有非本地 assets 请求。HTTP(S) 外链传给系统浏览器。M1 仅显示本地样例图，私有图片与联网代理在后续阶段接入。

## 消息与保存

bridgeVersion=1。原生到 Web 使用 WebViewCompat.postWebMessage 的 JSON 文本；Web 到原生使用 origin 限定的 snotesNative.postMessage。没有 addJavascriptInterface，生产代码不使用 evaluateJavascript 拼接 Markdown。

ready / load / change / flush / flushed / saved / saveError / openLink 已接入，额外使用 loaded、mode、flushError 与 resume 管理就绪和导航锁。文档消息带 profileId / noteId / sessionId，flush 响应另带 requestId；原生检查主 frame、origin、版本、长度、整数 revision 和当前会话。

文本变化增加 revision；组合输入结束但文本相同时仍发送同 revision 的 composing=false。800 ms debounce 前先写原子草稿；同会话尚未处理的 change 合并为最新全文，避免输入突发无限排队。flush 不合并，导航等持久化成功后才切换；锁保持到新文档 load，失败解除。

M1 使用应用私有 files/editor-prototype/ 中的样例 JSON 与原子草稿，记录提交 receipt，防止提交后尚未清理的草稿覆盖新正文。失败保留原稿；冲突保留两份内容。M2 才接 Room、完整笔记 Repository 和 outbox。尚未持久化确认的输入不能保证在立即杀进程后恢复。

## 测试

浏览器测试使用根项目的 Playwright，因此先执行根项目 npm ci 并安装 Chromium，再运行：

```powershell
npm --prefix android/editor-web test
.\android\gradlew.bat -p android :app:testDebugUnitTest :app:connectedDebugAndroidTest --console plain
```

浏览器测试将 localStorage 设为 null，复现 WebView 禁用存储的情况。Android 测试覆盖实时 flush、文档隔离、已确认 / 未确认输入的 Activity 重建、长文和原生 InputConnection。请求连接后，编辑调用按 InputConnection.getHandler() 指定线程执行，不假设运行在 Activity 主线程。

自动化结果不等同于人工拼音候选、TalkBack、厂商设备或真机性能验收。
