# Anima

An elegant AI companion for macOS.

## 开发

```bash
npm install
npm run dev
```

## macOS 打包

### 前置要求

- macOS
- Node.js + npm
- Python 3（用于启动内置后端，随应用一并打包到 `extraResources/pybackend`，运行时会由 Electron 拉起）

### 打包命令

```bash
npm install
npm run build
npm run dist:mac
```

也可以一条命令：

```bash
npm install
npm run dist:mac
```

### 产物位置

- `dist/` 目录下会生成：
  - `dist/*.dmg`
  - `dist/*.zip`
  - `dist/mac-*/Anima.app`（`--dir` 模式或部分 builder 版本会生成该目录结构）

### 图标

- 打包图标由 `build.mac.icon` 指定，目前为 `build/icon.icns`（由 `images/logo_padded.png` 生成）。

### 常见问题

- 看到旧图标：macOS 可能缓存 Dock/Finder 图标，移除 Dock 固定项后重新拖入，必要时执行 `killall Dock`。
- 未签名/未公证：当前配置 `build.mac.identity = null`，产物不会自动签名/公证，分发到其他机器可能触发 Gatekeeper 提示。

## 自动更新（GitHub Releases）

本项目已接入 `electron-updater` + `electron-builder` 的 GitHub Releases 发布配置：

- 生产环境启动时自动检查更新；也可在菜单栏 `Check for Updates…` 手动触发。
- 发布到 GitHub Releases 后，应用会从 `wxt2rr/Anima` 拉取更新元数据并下载更新包。

### 发版流程

1. 修改 `package.json` 的 `version`（例如从 `0.1.0` 改为 `0.1.1`），提交到仓库。
2. 打 tag 并推送：

```bash
git tag v0.1.1
git push origin v0.1.1
```

3. GitHub Actions 会在 macOS runner 上执行 `npm run dist:mac:publish`，并把产物上传到对应 tag 的 Release。

### 一键发版脚本

可以用脚本自动改版本号并执行 commit/tag/push：

```bash
npm run release -- 0.1.2
```

也支持交互输入版本号：

```bash
npm run release
```

### 无签名/无公证的提示

如果你还没有 Apple Developer 账号，macOS 上分发/升级可能会遇到 Gatekeeper 限制。常见处理方式：

- Finder 里对 App 右键 → 打开
- 或移除隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/Anima.app
```
