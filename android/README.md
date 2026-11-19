# snotes Android

[客户端设计](../docs/android/README.md) · [同步契约](../docs/android/sync-contract.md) · [实施计划](../docs/android/implementation-plan.md)

M0–M6 的内部交付实现已完成：离线编辑与同步、手机导航、独立实例、图片缓存和分享队列、桌面小组件、笔记本管理、格式 3 备份与打开统计。编辑区默认源码 + 预览，短文 IR 保留试用状态。内部安装包与自动验证见 [M4–M6 记录](../docs/android/acceptance/2026-11-20-m4-m6.md)，真机、中文输入法、系统选择器及正式签名门禁见 [人工验收清单](../docs/android/acceptance/manual-checklist.md)。这次是本地内部交付，尚未正式发布。

## 工具链

| 项目 | 固定版本 / 配置 |
| --- | --- |
| Gradle | 9.5.0，使用仓库 Wrapper 与发行包 SHA-256 校验 |
| Android Gradle Plugin | 9.3.0，启用内置 Kotlin |
| Kotlin / Compose compiler | 2.2.10 |
| JDK | 21；Java / Kotlin 字节码目标为 17 |
| KSP / Hilt | 2.3.14 / 2.60.1 |
| WebKit / Lifecycle / Coroutines | 1.18.0 / 2.9.4 / 1.10.2 |
| Room / Paging | 2.8.5 / 3.5.3；导出 schema，不使用 destructive migration |
| Compose BOM | 2026.09.00 |
| SDK | compile / target 37；SDK package 为 `platforms;android-37.0` |
| Build Tools | 36.0.0 |
| 最低系统 | Android 8.0 / API 26；低版本实机兼容性待验收 |
| applicationId | `io.github.xilele777.snotes`；debug 加 `.debug` 后缀 |

依赖版本在 [libs.versions.toml](gradle/libs.versions.toml)。AGP 9 已提供 Kotlin，不再应用 `org.jetbrains.kotlin.android` 插件。相关配套依据见 [AGP 9.3 发布说明](https://developer.android.com/build/releases/agp-9-3-0-release-notes)与 [内置 Kotlin 指南](https://developer.android.com/build/migrate-to-built-in-kotlin)。

Android Studio 打开本目录。构建还需要 Node.js 24 / npm，用于自动打包编辑器资源。设置 `JAVA_HOME`、`ANDROID_HOME`，或在本目录创建仅本机使用的 `local.properties`：

```properties
sdk.dir=D\:/AndroidEnv/SDK
```

路径换成实际 SDK 位置；该文件已忽略，不提交到版本库。缺少 SDK / Build Tools 时使用 Android Studio SDK Manager 安装表中的固定版本。

## 构建与测试

从仓库根目录执行：

```powershell
.\android\gradlew.bat -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console plain

# 启动模拟器或通过 ADB 连接设备后执行
.\android\gradlew.bat -p android :app:connectedDebugAndroidTest --console plain

# 同一组 JSON 契约的 TypeScript 侧
npx vitest run tests/unit/android-contract.test.ts

# 完整 Web / Worker / Node 回归
npm run test:all
npm run build
```

Linux / CI 使用 `bash android/gradlew -p android ...`。共享契约 JSON 来自 [contracts.json](../shared/fixtures/android-sync/contracts.json)，Kotlin 测试通过 Gradle test resources 读取同一文件，不手工复制。

Gradle 通过独立 lockfile 安装 editor-web 依赖并生成 assets，不依赖根 node_modules 构建 APK。编辑器浏览器测试使用根项目的 Playwright；说明见 [本地编辑页面](editor-web/README.md)。

APK：`android/app/build/outputs/apk/debug/app-debug.apk`。JVM 报告：`android/app/build/reports/tests/testDebugUnitTest/`。设备测试报告与 lint 报告也在 app build 目录；生成结果不纳入源码。

跨进程恢复使用 [verify-process-recovery.ps1](scripts/verify-process-recovery.ps1)，分别运行 prepare / verify，中间由 ADB force-stop 结束应用，验证已提交旧日志不重放与 revision 7 草稿恢复。夹具默认排除在普通 connected 测试之外；运行脚本前重新安装 Debug APK 与 androidTest APK，具体命令见 M2 验收记录。

如果 Java 未使用本机系统代理，在单次 Gradle 命令中加入代理参数。例如本次环境的代理是 `127.0.0.1:7890`：

```powershell
.\android\gradlew.bat -p android :app:assembleDebug --console plain '-Dhttps.proxyHost=127.0.0.1' '-Dhttps.proxyPort=7890' '-Dhttp.proxyHost=127.0.0.1' '-Dhttp.proxyPort=7890'
```

使用实际代理地址，PowerShell 中保留参数引号。机器代理设置不写入仓库 Gradle 配置。

## 版本与签名

`versionName` 从根 [package.json](../package.json) 读取，不在 Gradle 或文档里另写应用版本。构建同时检查根 `package-lock.json` 两处根版本是否一致，任何不一致均拒绝构建。

[release-sequence.properties](release-sequence.properties) 只保存 Android `versionCode` 安装顺序。每个不同的公开 APK / AAB（包括预发布）在发布前递增；未发布的本地构建可以重用当前 code。debug 使用独立 applicationId，不覆盖正式应用。

内部包使用 debug 签名，正式签名从环境变量 `SNOTES_KEYSTORE`、`SNOTES_STORE_PASSWORD`、`SNOTES_KEY_ALIAS`、`SNOTES_KEY_PASSWORD` 读取；未设置时 release 产物为未签名 APK，仅用于 R8 构建检查。签名文件、口令、SDK 路径与构建结果已忽略。CI 当前生成 debug 包与报告，生产密钥需存受保护的 Secret。发布沿用根 [AGENTS.md](../AGENTS.md)。

## 性能基线

`:benchmark` 使用独立 `.benchmark` applicationId，目标应用沿用 release 的 R8 / 资源压缩、非 debuggable、profileable、debug 签名。测量 APK 为自 instrumenting 测试模块，种子 Activity 只存在于目标 benchmark 变体。正式 debug / release 主包不包含种子 Activity。

```powershell
.\android\gradlew.bat -p android :benchmark:connectedBenchmarkAndroidTest --console plain --max-workers=2
# 仅模拟器采样时附加；不能用结果宣布真机预算达标
# '-Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.suppressErrors=EMULATOR'
```

各 10 轮无预编译冷启动，500 条元数据与约 2,000 字符已缓存笔记；首帧和本机列表 / 编辑器准备完成分别记录。原始 JSON 与 trace 在 `benchmark/build/outputs/connected_android_test_additional_output/`，交付记录保存统计与设备信息。

## 开发后端

连接配置前只使用本地笔记；M3 手动接入与同步使用现有后端：

- Node.js：从根目录按 [开发指南](../docs/development.md)和[服务器部署指南](../docs/server-deployment.md)启动隔离开发实例。
- Worker：先在根目录应用本地迁移，再运行 `npm run dev:worker`；不用生产数据库。
- 模拟器访问宿主机地址为 `10.0.2.2`；debug 网络策略只允许 `10.0.2.2`、`127.0.0.1`、`localhost` 明文访问。release 全部使用 HTTPS。

默认活跃 profile 为 `local-default`，数据库、WAL、草稿与图片目录分别隔离在应用私有 `files/profiles/<profile-id>/`。更换 origin 创建新 profile，设置可切回旧空间；先停止同步并等待在途请求，拒绝旧编辑会话与旧 Worker 的写入。生产源码不会读取根 `.dev.vars` 或将服务端令牌打入 APK；专用测试 token 仅存在于显式运行的隔离后端与 androidTest 夹具中。

## 数据与系统边界

主 Manifest 关闭自动备份，同时配置旧版 full backup 与新版 cloud / device transfer 排除规则。编辑器与本地库接入后继续沿用这些规则，显式导出负责数据携带。

Compose 处理 edge-to-edge 与系统主题。应用直接申请网络权限，WorkManager 合并唤醒 / 开机接收 / 前台服务权限；当前没有启动常驻前台服务。图片使用 Photo Picker，导入导出使用 SAF，无宽泛照片 / 存储权限。接收分享在临时 URI 权限有效时先复制图片至私有目录；文字先落库，离线附件后台重试。小组件只读本机最近五篇，不初始化编辑器。

图片私有缓存上限 128 MiB，达到上限仍可联网显示 / 上传，不删除未同步文件。格式 3 备份包含正文、回收站、历史、图片与分享队列，解压总量上限 128 MiB，校验并准备文件后在一次 Room 事务内导入。导入相同 ID 保留已有正文，备份中的不同正文进入历史。偏好使用 SharedPreferences；令牌独立使用 Keystore 加密文件。

当前验收采用用户指定的模拟器，记录见 [M0](../docs/android/acceptance/2026-11-19-m0.md)、[M1](../docs/android/acceptance/2026-11-19-m1.md) 和 [M2](../docs/android/acceptance/2026-11-20-m2.md)。模拟器自动化与人工输入法、真机性能验收分开记录。
