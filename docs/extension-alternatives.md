# 玄机 IDE 扩展替代方案

玄机 IDE 使用 Open VSX 作为扩展市场，部分 Microsoft 专有扩展无法从 Open VSX 获取。以下是经过验证的替代方案。

## 替代方案列表

### C/C++ 开发

| 项目 | 详情 |
|------|------|
| **被封锁扩展** | ms-vscode.cpptools (C/C++) |
| **替代方案** | clangd |
| **Open VSX ID** | `llvm-vs-code-extensions.vscode-clangd` |
| **安装命令** | 扩展面板搜索 "clangd" 或命令行: `xuanji --install-extension llvm-vs-code-extensions.vscode-clangd` |
| **说明** | 基于 clangd language server，提供代码补全、跳转定义、重构等功能。需要系统安装 clangd（`apt install clangd` / `brew install llvm`）。 |

---

### Python 开发

| 项目 | 详情 |
|------|------|
| **被封锁扩展** | ms-python.vscode-pylance |
| **替代方案** | Pyright |
| **Open VSX ID** | `ms-pyright.pyright` |
| **安装命令** | 扩展面板搜索 "Pyright" 或命令行: `xuanji --install-extension ms-pyright.pyright` |
| **说明** | Pylance 的开源核心，提供类型检查、自动补全、跳转定义。功能上覆盖 Pylance 大部分能力。 |

---

### 远程开发

| 项目 | 详情 |
|------|------|
| **被封锁扩展** | ms-vscode-remote.* (Remote SSH / Containers / WSL) |
| **替代方案** | Open Remote SSH |
| **Open VSX ID** | `jeanp413.open-remote-ssh` |
| **安装命令** | 扩展面板搜索 "Open Remote SSH" 或命令行: `xuanji --install-extension jeanp413.open-remote-ssh` |
| **说明** | 开源的 Remote SSH 实现，支持通过 SSH 连接远程服务器进行开发。基本功能与 ms-vscode-remote.remote-ssh 相当。 |

---

### C# 开发

| 项目 | 详情 |
|------|------|
| **被封锁扩展** | ms-dotnettools.csharp |
| **替代方案** | C# (OmniSharp) |
| **Open VSX ID** | `muhammad-sammy.csharp` |
| **安装命令** | 扩展面板搜索 "C#" 或命令行: `xuanji --install-extension muhammad-sammy.csharp` |
| **说明** | 基于 OmniSharp 的 C# 支持，提供智能感知、调试、重构等功能。需要系统安装 .NET SDK。 |

---

## 快速参考

| 被封锁扩展 | 替代方案 | Open VSX ID |
|-----------|---------|-------------|
| ms-vscode.cpptools | clangd | `llvm-vs-code-extensions.vscode-clangd` |
| ms-python.vscode-pylance | Pyright | `ms-pyright.pyright` |
| ms-vscode-remote.* | Open Remote SSH | `jeanp413.open-remote-ssh` |
| ms-dotnettools.csharp | C# (OmniSharp) | `muhammad-sammy.csharp` |
