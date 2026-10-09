# L-Edit 本地配置说明

## 1. 获取软件

从 [Siemens 官方 L-Edit 页面](https://resources.sw.siemens.com/zh-CN/fact-sheet-tanner-l-edit-ic/)了解产品，并通过供应商获取可用安装程序和授权。该链接是产品介绍，不承诺提供旧版本 15.0 的直接下载。公开仓库不附带 L-Edit 软件。

已有 L-Edit 时，可以直接连接本地安装。当前版图流程通过 Windows 桌面窗口和菜单执行导出，旧版本 15.0 的配置方式可以沿用；不同版本的菜单和导出行为仍需实际验证。应在已登录、有桌面的 Windows 会话中运行。

## 2. 配置程序路径

不要只复制 `ledit.exe`：程序通常还需要原安装目录的 DLL、资源文件和运行库。保持完整安装目录，并先确认 L-Edit 能独立正常打开。

在工程根目录将 `.env.example` 复制为 `.env`，编辑下列一项，使用自己的实际绝对路径。路径含空格时可以用双引号包住整个值。

```dotenv
APP_LEDIT_EXE="C:\Program Files (x86)\Tanner EDA\Tanner Tools v15.0\ledit.exe"
APP_USE_BUNDLED_VENDOR=false
```

也可以使用随项目提供的配置脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-ledit.ps1 -ExecutablePath "C:\实际安装目录\ledit.exe"
```

脚本只检查文件并修改本机 `.env`，不会上传软件或许可证。若已存在 `.env`，先保存一份 `.env.local.bak` 便于恢复。

临时指定路径也可以：

```powershell
.\start.bat --ledit-exe "C:\实际安装目录\ledit.exe"
```

## 3. 安装依赖并生成版图内容

1. 按 README 安装 Python 依赖并构建网页。
2. 启动 `start.bat`，确认启动窗口显示实际 L-Edit 路径。
3. 浏览器打开 `http://127.0.0.1:5173/product-manual`。
4. 在右侧选择“版图”，上传有权处理的 `.tdb` 文件。
5. 点击“生成产物”；等待 L-Edit 窗口处理，不要同时操作该窗口。
6. 检查回填的功能框图、外形尺寸图、建议装配图和压点表，然后导出手册。

生成结果保存在 `generated_layout_assets/`，该目录不会提交到源码仓库。

## 4. 故障排查

- 启动提示找不到 L-Edit：检查 `.env` 中的路径是否确实指向可执行文件。
- L-Edit 本身打不开：先修复其安装、授权和配套运行库，再使用手册版图功能。
- 出现 `WinError 14001`：检查 Windows SideBySide 日志；旧版工具可能依赖 Visual C++ 2008 SP1 MFC x86 运行库，通过微软或供应商的可信来源安装。
- 长时间没有导出：检查 L-Edit 桌面是否被提示框阻挡，确认 `.tdb` 可以在工具中正常打开。
- 未安装 L-Edit：仍可编辑手册、导入 Excel、绘制曲线和导出；TDB 自动生成暂不可用。
