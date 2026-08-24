# 星迹 StarTrace Server

[![CI](https://github.com/ishidadao/StarTrace-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/ishidadao/StarTrace-Server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6f5bd3.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-43853d.svg)](package.json)

面向《原神》与《鸣潮》的自托管抽卡记录、保底追踪与数据分析网站。

星迹按“网站账号 + 游戏 + 游戏 UID”隔离数据，支持多账号、多 UID 管理，并提供保底进度、五星历史、卡池趋势、稀有度分布、UP/歪/大保底判定和幸运画像。此仓库仅包含服务器端与网页前端，Windows 客户端在另一个仓库。

本公开版本保留可独立部署的用户名/密码账号体系。

> 在线实例仅用于展示项目效果。自行部署的实例拥有独立账号与数据库，数据不会与其他星迹实例互通。

如果觉得有用的话不妨点个Star⭐支持一下主包，十分感谢！

## 功能特色

- **严格的数据隔离**：记录主键包含网站用户、游戏、UID 与记录 ID，原神、鸣潮以及不同 UID 不会互相覆盖。
- **安全的独立账号体系**：用户名与密码登录；密码使用 PBKDF2-SHA256 加盐哈希，会话令牌仅以 SHA-256 摘要入库。
- **安全的 JSON 导入**：上传内容只经过 JSON 解析、字段白名单与长度校验，再以参数化 SQL 写入规范化字段；不落盘原始上传文件，也不会执行上传内容。
- **重复记录防护**：原神按记录 ID 幂等写入；鸣潮针对客户端记录 ID 变化额外使用自然键去重。
- **多卡池保底统计**：分别维护角色活动、武器活动、常驻、新手、集录及鸣潮各类唤取的保底计数。
- **UP 状态回放**：结合历史卡池信息判定 UP、歪、大保底、鸣潮限定武器必中与可严格推断的捕获明光。
- **抽卡分析**：提供平均出金、幸运画像、活跃趋势、稀有度分布和完整五星记录。
- **完整备份与恢复**：一键下载当前网站账号下全部原神、鸣潮及 UID 记录；重装或迁移后可直接重新导入。
- **角色与武器图标**：按物品 ID 或名称补全图标；上游不可用时自动回退，不影响记录读取。
- **动态响应式界面**：数字、保底环、稀有度环与趋势图随数据平滑过渡，同时尊重系统“减少动态效果”设置。

## 部分效果图

<img width="1919" height="914" alt="image" src="https://github.com/user-attachments/assets/9c4c0b2f-9314-4901-8257-3eda4258c2aa" />


<img width="1904" height="911" alt="image" src="https://github.com/user-attachments/assets/35145c06-67db-4eaf-bec9-a5285d26a396" />


## 技术栈

- React 19 + TypeScript
- Vinext / Vite
- Cloudflare Workers Runtime
- Cloudflare D1 / 本地 Miniflare SQLite
- Drizzle ORM 与版本化 SQL 迁移

## 快速开始

### 环境要求

- Node.js `22.13.0` 或更高版本
- npm
- Linux、macOS 或 Windows 均可用于开发；生产自托管示例以 Linux 为准

### 本地运行

```bash
git clone https://github.com/ishidadao/StarTrace-Server.git
cd StarTrace-Server
npm ci
npm run dev
```

开发服务器会输出本地访问地址。首次注册、登录或上传时，应用会在项目本地的 `.wrangler/` 状态目录中自动创建所需数据表，无需预先导入真实数据库。

### 运行测试

```bash
npm test
npm run lint
```

### 生产构建

```bash
npm ci
npm run build
```

构建产物位于 `dist/`。不要把开发环境中的 `.wrangler/`、`.env*` 或数据库文件提交到版本库。

## Linux 自托管安装

仓库提供了 systemd 与 Caddy 示例，默认约定：

- 项目目录：`/opt/startrace-server`
- 服务用户：`startrace`
- 应用监听：`127.0.0.1:3444`
- HTTPS 示例入口：`startrace.example.com`

先创建专用用户并安装项目：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin startrace
sudo git clone https://github.com/ishidadao/StarTrace-Server.git /opt/startrace-server
sudo chown -R startrace:startrace /opt/startrace-server
sudo -u startrace npm --prefix /opt/startrace-server ci
sudo -u startrace npm --prefix /opt/startrace-server run build
```

安装并启动 systemd 服务：

```bash
sudo cp /opt/startrace-server/deploy/startrace-gacha.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now startrace-gacha.service
```

将 `deploy/startrace.caddy` 中的 `startrace.example.com` 替换为自己的域名，合并到 Caddy 配置后重新加载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

生产环境必须使用 HTTPS，因为浏览器登录会话使用 `Secure`、`HttpOnly`、`SameSite=Strict` Cookie。应用端口仅监听回环地址，不应直接暴露到公网。

### 更新版本

```bash
cd /opt/startrace-server
sudo -u startrace git pull --ff-only
sudo -u startrace npm ci
sudo -u startrace npm run build
sudo systemctl restart startrace-gacha.service
```

更新前请备份 `/opt/startrace-server/.wrangler/state/`。

从 `1.0.0` 或更早版本升级到 `1.0.1` 及后续版本后，请让 Windows 客户端重新同步一次鸣潮完整记录。服务端会自动增加同秒十连序号字段；重新同步可为旧记录补齐顺序，使当前垫抽数与游戏及 Haiyu 一致。

## 版本记录

详见 [CHANGELOG.md](CHANGELOG.md)。

## 数据与 API

### 数据隔离模型

抽卡记录使用以下组合主键：

```text
owner_key + game + uid + record_id
```

上传批次中的每条记录必须与请求 UID 一致。接口只接受 `genshin` 或 `wuwa`，拒绝无效 UID、稀有度、空记录 ID、空时间和超过 10,000 条的单次批次。

### 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/register` | 注册并返回会话 |
| `POST` | `/api/auth/login` | 登录并返回会话 |
| `POST` | `/api/auth/logout` | 注销当前会话 |
| `GET` | `/api/auth/session` | 获取当前登录用户 |
| `POST` | `/api/auth/migrate` | 迁移旧同步密钥空间 |
| `GET` | `/api/records` | 列出当前用户的游戏账号 |
| `GET` | `/api/records?game=genshin&uid=100000001` | 读取指定游戏与 UID |
| `POST` | `/api/records` | 上传单一游戏、单一 UID 的记录批次 |
| `GET` | `/api/records/export` | 下载当前用户全部游戏与 UID 的可移植 JSON 备份 |

Windows 或其他桌面客户端可使用登录接口返回的 Bearer Token：

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

上传请求示例：

```json
{
  "game": "genshin",
  "uid": "100000001",
  "source": "desktop",
  "records": [
    {
      "uid": "100000001",
      "recordId": "1234567890",
      "poolType": "301",
      "itemId": "10000099",
      "itemName": "示例角色",
      "itemType": "角色",
      "rarity": 5,
      "pulledAt": "2026-08-23 12:00:00"
    }
  ]
}
```

### 兼容数据来源

- 原神：UIGF v2 JSON、FufuLauncher 导出结构及 `getGachaLog` 常见字段。
- 鸣潮：Haiyu `RecordCacheDetily` JSON 及 `gacha/record/query` 常见字段。

不同工具的导出格式可能随版本变化。如果导入失败，请先删除令牌、UID 等敏感信息，再提交最小化示例到 Issue。

### 备份与恢复

登录后点击总览页的“下载备份”，即可生成 `startrace-backup-日期.json`。备份按游戏与 UID 分组，仅包含恢复抽卡记录所需的规范化字段，不包含密码、会话令牌、Cookie 或服务器数据库。

恢复时登录目标实例，点击“导入记录”并选择该备份文件。星迹会自动识别其中的原神、鸣潮与不同 UID，按照与普通导入相同的校验和幂等规则写入，因此重复导入不会重复累计已有记录。

## 安全说明

- 不要公开抽卡链接中的 `authkey`、登录返回的 Bearer Token、Cookie 或数据库状态目录。
- 不要将 `.wrangler/`、`.env*`、数据库文件、日志、证书或生产配置提交到 Git。
- 应用会拒绝声明超过 8 MiB 的请求体；公开实例仍建议在反向代理层增加独立的请求体限制、速率限制和日志脱敏。
- 本项目不会执行上传 JSON 中的字符串；所有数据库写入均使用参数绑定。JSON 字段中的 SQL 片段或脚本只会被当作普通数据处理。
- 登录输入在服务端执行类型、长度与字符集校验，认证请求体限制为 4 KiB，数据库查询使用参数绑定。密码以随机盐 PBKDF2-SHA256（310,000 次迭代）保存，并通过固定成本的占位校验减弱用户名枚举的时序差异。
- 不应在前端把密码简单哈希后直接当作登录凭据：该摘要会变成可重放的“等效密码”，既不能代替参数化 SQL，也不能保护服务端数据库。安全边界必须放在服务端校验、密码派生、限速与参数绑定上。
- 公开实例运营者应自行补充备份、监控、隐私政策、账号删除机制以及适用地区要求的安全控制。

如发现安全漏洞，请不要在公开 Issue 中披露利用细节，参见 [SECURITY.md](SECURITY.md)。

## 项目结构

```text
app/        页面与 API 路由
db/         Drizzle 数据模型
drizzle/    数据库迁移
lib/        认证、存储、统计、图标与 UP 判定
worker/     Cloudflare Worker 入口
deploy/     systemd 与 Caddy 自托管示例
tests/      统计和页面测试
```

## 免责声明

本项目是非官方、非商业的社区工具，与米哈游、HoYoverse、库洛游戏及其关联公司不存在隶属、授权或背书关系。《原神》《鸣潮》及相关名称、角色、图像和商标归各自权利人所有。

项目按“原样”提供，不保证抽卡记录、历史卡池、图标、保底或幸运计算在任何时间都完整、准确或持续可用。游戏规则、接口与第三方数据源可能变化。使用者应自行核对关键数据，并自行承担部署、账号、隐私、数据丢失、服务中断及使用第三方接口带来的风险。

请遵守游戏服务条款、当地法律和上游数据源规则。本项目不鼓励绕过访问控制、批量滥用接口或收集他人凭据。

## 开源协议

本项目采用 [MIT License](LICENSE)。你可以使用、复制、修改、合并、发布和再分发代码，但必须保留原始版权与许可声明。

MIT 许可不授予任何游戏素材、名称、商标或第三方数据的权利。

## 致谢

- [FufuLauncher](https://github.com/FufuLauncher/FufuLauncher)：原神抽卡记录获取与格式参考。
- [Haiyu](https://github.com/HaiyuGame/Haiyu)：鸣潮抽卡记录获取与格式参考。
- [UIGF-org](https://github.com/UIGF-org)：提供统一标准化的原神数据格式。
