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
