# GitHub 公开上传操作流程

本项目目标仓库：[Wang-xiaozi/generic-product-manual](https://github.com/Wang-xiaozi/generic-product-manual)。

## 上传哪些文件

上传 `E:\Manual\Manual-public` 文件夹内的通用版源码。不要上传原版 `E:\Manual\Manual`、原版 ZIP 或 `local_backups` 完整备份。L-Edit 只保留官方产品链接和本地配置说明。

源码仓库不提交 `.env`、`frontend_v2/node_modules/`、`frontend_v2/dist/`、`pipeline/vendor/`、`offline_environment/`、运行版图数据及 ZIP 文件。项目自带 `.gitignore` 处理这些排除项；预构建 ZIP 可作为 Release 附件上传。

## 方法一：GitHub Desktop

1. 安装 [GitHub Desktop](https://desktop.github.com/)，登录自己的 GitHub 账号。
2. 打开 PowerShell，执行以下两行，在通用版目录初始化本地仓库；重复执行 `git init` 不会清空文件。

   ```powershell
   Set-Location -LiteralPath 'E:\Manual\Manual-public'
   git init -b main
   ```

3. 在 GitHub Desktop 选择 **File → Add local repository**，选择 `E:\Manual\Manual-public`，点击 **Add repository**。
4. 查看 **Changes** 文件列表，确认没有 `.env`、原版标志、L-Edit 软件、原版备份或版图数据。正常应看到 README、前后端源码、模板和测试等文件。
5. 左下方 Summary 填写 `Publish generic product manual editor`，点击 **Commit to main**。
6. 点击 **Publish repository**，名称建议 `generic-product-manual`，描述可填写 `Generic product manual editor with Excel import, curves and Word/PDF export`。
7. 选择自己的账号或有权使用的组织；取消勾选 **Keep this code private**，点击 **Publish Repository**，使仓库公开。
8. 点击 **View on GitHub**。检查 README 和目录内容；退出账号或使用浏览器无痕窗口打开该地址，确认匿名访客能查看。

官方步骤见 [使用 GitHub Desktop 发布已有项目](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop)。

## 方法二：Git 命令行

1. 登录 GitHub，点击右上角 **+ → New repository**。
2. 输入仓库名，例如 `generic-product-manual`；选择 **Public**。
3. 创建一个空仓库：不要勾选初始化 README、.gitignore 或 License，避免与本地内容产生首次提交冲突。点击 **Create repository**。
4. 在 PowerShell 逐项执行下列命令。将远程地址中的 `YOUR-ACCOUNT` 和仓库名替换成刚创建的实际值。

   ```powershell
   Set-Location -LiteralPath 'E:\Manual\Manual-public'
   git init -b main
   git status --short
   git add .
   git diff --cached --stat
   git diff --cached --name-only
   git commit -m "Publish generic product manual editor"
   git remote add origin https://github.com/Wang-xiaozi/generic-product-manual.git
   git push -u origin main
   ```

5. 若提交时提示缺少身份，仅在此仓库设置自己的姓名和 GitHub 隐私邮箱，然后重试提交。示例中的姓名和邮箱必须替换成自己的值。

   ```powershell
   git config user.name "Your Name"
   git config user.email "YOUR-GITHUB-NOREPLY-EMAIL"
   ```

6. 推送时按 Git Credential Manager 提示通过浏览器登录 GitHub；不要把访问令牌写入源码、远程 URL 或教程。
7. 刷新 GitHub 仓库并检查公开内容。若 `origin` 已存在，先用 `git remote -v` 确认地址正确，正确时跳过 `git remote add`。若仓库已含提交，先克隆到另一个空目录并复制通用版文件，再提交；不要强制推送覆盖已有历史。

官方说明见 [添加文件到 GitHub 仓库](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)。网页上传每个文件限制 25 MiB，Git 命令行普通文件上限 100 MiB；本项目用 Desktop 或 Git 上传目录更方便。

## 附加发布 ZIP，供使用者下载

源码上传完成后，在仓库右侧选择 **Releases → Draft a new release**。

1. Tag 填 `v1.0.0`，选择创建新标签，Target 选 `main`。
2. Release title 填 `通用产品手册编辑器 v1.0.0`。
3. 说明填写：`通用模板，无默认单位标识；支持 Excel、曲线、Word/PDF/HTML 导出。需要安装 Python 依赖。智能助手和 TDB 版图生成功能需自行配置；不包含 L-Edit 软件。`
4. 把 `E:\Manual\Manual-public.zip` 和同目录的 `Manual-public.zip.sha256` 拖入附件区域。
5. 点击 **Publish release**；需要先保存时选择 **Save draft**。

发布 ZIP 已带网页构建结果，用户解压后安装 Python 依赖即可启动，不需要再安装 Node.js。GitHub 自动生成的 Source code ZIP 只有源码，用户仍需自行构建前端。

官方步骤见 [管理仓库的 Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。

## 后续更新

修改通用版源码后重新构建前端，再生成新的发布 ZIP。Desktop 使用 **Commit → Push origin**；命令行使用 `git add .`、`git commit`、`git push`。每次更新 ZIP 时使用新版本标签，并更新校验文件。

远程版本以目标仓库和 Releases 页面为准。公开仓库托管代码，不会自动部署本项目所需的 Python 后端。
