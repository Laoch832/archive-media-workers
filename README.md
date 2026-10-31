# 加密压缩包 → 每组作品一个 Cloudflare Worker

一个有密码的 `.7z` 是一组作品。递归读取内部的“图包”“视频”（或其他名称）目录，图片、视频数量不限于一个；图视频混合、只有图片、只有视频均可。同一作品内所有媒体都部署至同一个独立 Worker，不为每个文件创建 Worker。

## 使用现有 Cloudflare Secrets

新仓库保存所有处理与发布代码。现有 `Laoch832/cloudflare_photoREPO_zrl` 的 Actions 提供 `Publish encrypted media archive` 桥接入口，以 `secrets: inherit` 调用本仓库 `publish.yml`。部署记录出现在调用方仓库的 Actions 中。这是 GitHub 可复用工作流的运行方式；Secrets 不被读取、输出或复制。

1. 打开 [部署入口](https://github.com/Laoch832/cloudflare_photoREPO_zrl/actions/workflows/media-bridge.yml)。
2. `Run workflow`，测试时勾选 `demo`；真实作品取消勾选。
3. 设置不同的 `work_id`，例如 `collection-001`。相同 ID 更新原 Worker，不同 ID 创建独立 Worker。中文 ID 也能使用。
4. 真实作品：在调用方仓库 Actions Secrets 设置 `MEDIA_ARCHIVE_PASSWORD`；输入可下载的 HTTPS `.7z` URL。含签名的私密链接推荐存为 `MEDIA_ARCHIVE_URL` Secret，并将输入 URL 留空。下载地址必须直接返回文件，不支持跳转和网盘网页。
5. 完成后，运行 Summary 显示 Worker 地址。Artifacts 只包含构建与验证报告，不含原压缩包、密码、完整媒体。

密码不放在 workflow 输入、仓库代码或日志中。更换压缩包密码时先更新 Secret；同一调用方并行发布不同密码的作品应分别使用独立的 Secret/入口，当前单个 `MEDIA_ARCHIVE_PASSWORD` 适合串行提交。

若希望直接在本仓库 Actions 点发布，在本仓库另配 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 和真实作品所需 Secrets，运行 `Publish archive as independent Worker`。没有单独配置时使用上面的桥接入口。

## 媒体与限制

- 图片保留 JPEG/PNG/WebP/GIF/AVIF 原文件；超过 25 MiB 的图片及 BMP/TIFF 转为最大 4096 像素 WebP（大动图转为首帧）。
- 视频统一 H.264/AAC，最大 1080p、视频码率上限 8 Mbps、4 秒 HLS 切片。完整转码后检查每个切片 ≤25 MiB。字幕与附加轨道不发布。
- 构建默认按免费计划检查每个 Worker 不超过 20,000 个文件。超限明确失败，不拆成多个 Worker。Cloudflare 账号的 Worker 数量限额仍适用。
- 压缩文件最大 8 GiB、解压总量最大 10 GiB、最多 50,000 个条目；GitHub Runner 磁盘与 180 分钟超时可能更早成为瓶颈。体量更大需更大 Runner。
- 不支持的文件（如 TXT）记录为 skipped。损坏的支持格式会使构建失败，避免静默漏掉作品。
- 只支持完整、单文件压缩包，不支持 `.7z.001` 分卷。
- 部署后的作品可通过 Worker 的公开 URL 访问。归档密码仅用于解压，不会成为观看密码。

静态媒体直接存入 Workers Static Assets，视频不塞进 Worker JS，也不依赖 R2 或 Stream。播放器随部署携带 HLS.js，可在支持原生 HLS 的 Safari 及支持 MediaSource 的浏览器播放。

## 本地运行

需要 Node 24、FFmpeg、7-Zip。Linux 用 `7zz`，Windows 设置 `SEVEN_ZIP` 为 `7z.exe` 完整路径。安装依赖后：

```powershell
npm ci
npm test
$env:SEVEN_ZIP = 'C:\Program Files\7-Zip\7z.exe'
$env:ARCHIVE_PASSWORD = '由本机安全注入的密码'
node scripts/build.mjs --archive 'D:\作品.7z' --id collection-001
npm run verify
# 在本机配置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 后
npm run deploy
```

Actions 包含真实加密 7z、错误密码、中文路径、混合/图片单目录作品、独立命名、HLS 完整解码、静态文件数量与大小检查。部署后逐个比对图片、播放列表和所有视频切片的 SHA-256，并通过公网 URL 解码每个完整视频，再在 Chromium 核对全作品计数、抽样实测最多 3 张图片和 2 个视频的播放进度与画面尺寸，保存视口截图与报告，避免大图包撑爆浏览器。`/api/health` 返回本作品计数。

参考：[Cloudflare 平台限制](https://developers.cloudflare.com/workers/platform/limits/)、[GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[GitHub 可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。
