# snotes Android

[客户端设计](../docs/android/README.md) · [同步契约](../docs/android/sync-contract.md) · [实施计划](../docs/android/implementation-plan.md)

当前 M0–M3 已实现：Room / Paging 本地笔记与离线编辑器、Keystore 连接配置、双域恢复预检与服务端同步、失败任务恢复。编辑区默认源码 + 预览，短文 IR 保留试用状态；Debug 首页仍可打开样例原型。正在推进 M4–M6 与人工验收包，结果见 [M2](../docs/android/acceptance/2026-11-20-m2.md) 和 [M3](../docs/android/acceptance/2026-11-20-m3.md)。

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

release 未配置生产签名。正式发布时从受保护的本机 / CI 配置读取签名信息，签名文件、口令、SDK 路径与构建结果已忽略。发布沿用根 [AGENTS.md](../AGENTS.md)，不会因本地 assemble 自动推送或部署。

## 开发后端

连接配置前只使用本地笔记；M3 手动接入与同步使用现有后端：

- Node.js：从根目录按 [开发指南](../docs/development.md)和[服务器部署指南](../docs/server-deployment.md)启动隔离开发实例。
- Worker：先在根目录应用本地迁移，再运行 `npm run dev:worker`；不用生产数据库。
- 模拟器访问宿主机地址为 `10.0.2.2`；debug 网络策略只允许 `10.0.2.2`、`127.0.0.1`、`localhost` 明文访问。release 全部使用 HTTPS。

默认活跃 profile 为 `local-default`，数据库、WAL、草稿与图片目录分别隔离在应用私有 `files/profiles/<profile-id>/`。M3 支持首次实例接入、当前令牌修复与手动同步；实例更换在 M4 增加。生产源码不会读取根 `.dev.vars` 或将服务端令牌打入 APK；专用测试 token 仅存在于显式运行的隔离后端与 androidTest 夹具中。

## 数据与系统边界

主 Manifest 关闭自动备份，同时配置旧版 full backup 与新版 cloud / device transfer 排除规则。编辑器与本地库接入后继续沿用这些规则，显式导出负责数据携带。

Compose 处理 edge-to-edge 与系统主题。M0 仅申请网络权限，不申请照片、存储、相机或通知权限。系统选择器与相应操作在功能实现时接入。

当前验收采用用户指定的模拟器，记录见 [M0](../docs/android/acceptance/2026-11-19-m0.md)、[M1](../docs/android/acceptance/2026-11-19-m1.md) 和 [M2](../docs/android/acceptance/2026-11-20-m2.md)。模拟器自动化与人工输入法、真机性能验收分开记录。
