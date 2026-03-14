# 玄机 IDE 安装指南

## 系统要求

| 平台 | 最低要求 |
|------|---------|
| Windows | Windows 10 x64 或更高 |
| macOS | macOS 11 (Big Sur) arm64 或更高 |
| Linux | Ubuntu 20.04+、Fedora 36+ 或同等 x64 发行版 |

## Windows

### 安装器安装
1. 下载 `XuanJi-Setup-<版本号>.exe`
2. 双击运行安装程序
3. 按向导提示完成安装
4. 从开始菜单或桌面快捷方式启动"玄机"

### 已知限制
- 安装器未经代码签名，Windows SmartScreen 可能弹出警告
- 点击"更多信息" → "仍要运行"即可继续安装

## macOS

### DMG 安装
1. 下载 `XuanJi-<版本号>.dmg`
2. 双击挂载 DMG
3. 将"玄机"拖入 Applications 文件夹
4. 从 Launchpad 或 Applications 启动

### 已知限制
- 应用未经 Apple 公证，首次启动需手动允许
- 系统偏好设置 → 安全性与隐私 → 点击"仍要打开"
- 或右键点击应用 → "打开"

## Linux

### deb 包安装 (Ubuntu/Debian)
```bash
sudo dpkg -i xuanji_<版本号>_amd64.deb
sudo apt-get install -f  # 安装缺少的依赖
```

### AppImage (通用)
```bash
chmod +x XuanJi-<版本号>.AppImage
./XuanJi-<版本号>.AppImage
```

AppImage 无需安装，直接运行即可。

### 已知限制
- 部分 Wayland 环境下可能需要添加 `--ozone-platform=wayland` 参数

## 通用已知限制

- **无自动更新**: Alpha 阶段不提供自动更新，需手动下载新版本
- **扩展市场**: 使用 Open VSX 市场，部分 VS Code 专有扩展不可用
- **Rust 桥接**: Tauri sidecar 功能视集成进度而定

## 卸载

### Windows
通过"设置 → 应用 → 玄机"卸载，或运行安装目录下的 `unins000.exe`

### macOS
将应用从 Applications 文件夹移至废纸篓

### Linux (deb)
```bash
sudo dpkg -r xuanji
```

### Linux (AppImage)
直接删除 AppImage 文件即可
