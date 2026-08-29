# 项目协作与版本发布规范

## 当前版本

- 当前应用版本：`0.4.0`
- 版本号唯一来源：根目录 `package.json` 的 `version` 字段。
- `package-lock.json` 的根项目版本必须与 `package.json` 保持一致。
- Cloudflare Worker 自动生成的 UUID（Deployment/Version ID）用于定位线上部署，不能替代应用版本号。
- 笔记同步中的 `version`、`prop_version`、`body_version` 是数据同步版本，不能当作应用发布版本。

## 版本号规则

使用语义化版本号（Semantic Versioning）：`MAJOR.MINOR.PATCH`，发布标签使用同样的 `v` 前缀格式。

- `PATCH`：向后兼容的 bug 修复、文案或小范围内部改动，例如 `0.1.1`。
- `MINOR`：向后兼容的新功能，例如 `0.2.0`。
- `MAJOR`：不向后兼容的 API、数据格式或部署行为变更，例如 `1.0.0`。
- 尚未稳定的版本可以使用预发布标识，例如 `0.2.0-beta.1`。

## 每次正式上线的流程

1. 确定下一版本号，并同步修改 `package.json` 与 `package-lock.json`。
2. 更新 `CHANGELOG.md`，记录用户可感知的新增、修复和破坏性变更。
3. 运行验证：

   ```bash
   npm run test:all
   npm run build
   ```

4. 提交版本变更，提交信息使用：`chore(release): vX.Y.Z`。
5. 创建 Git 标签：`git tag -a vX.Y.Z -m "Release vX.Y.Z"`。
6. 推送提交和标签：`git push origin main --follow-tags`。
7. 执行生产部署：`npm run deploy`。
8. 记录 Cloudflare 返回的 Deployment/Version ID，并在 GitHub 对应标签下创建 Release。

如果部署失败，不得把失败的部署标记为已发布版本；修复后继续使用新的补丁版本号。

## GitHub Release

GitHub 可以承载正式发布版本。发布时必须使用与 `package.json` 一致的标签，例如 `v0.1.0`，并将 `CHANGELOG.md` 对应条目作为 Release notes。可以在 GitHub 网页的 **Releases → Draft a new release** 操作，也可以使用 GitHub CLI：

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file RELEASE_NOTES.md
```

GitHub Release 是面向用户的发布记录；Cloudflare Deployment/Version ID 是面向运维的线上部署记录，两者都要保留。

## 注意事项

- 不要重复使用已经推送过的版本号或标签。
- 不要仅修改 Cloudflare 部署版本而不更新 Git 版本和发布记录。
- 修改数据库迁移时，仍需按 `migrations/000N_*.sql` 递增；数据库迁移编号与应用版本号是两套独立序列。
