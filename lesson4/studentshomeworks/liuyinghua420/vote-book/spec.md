# 图书投票应用 — 规格说明书（v1.3）

## 1. 功能概述

一个单页图书投票应用，展示 5 本图书（含真实封面、作者和简介）。用户可直接浏览图书及票数，注册/登录后每用户限投 3 票，票数实时更新，投票后不可修改。后端基于文件持久化存储。

v1.2 新增：
- 豆瓣 CDN 封面直链 + 启动时自动抓取封面与简介
- 管理员模式（首个注册用户为 admin，可添加图书）
- 邮箱注册 + 密码找回机制

v1.3 新增：
- 预置管理员账号（admin / 123456）
- 图书 CRUD（编辑、删除）
- 一键重置投票 + 投票历史存档
- 管理员前端管理面板
- Nodemailer SMTP 邮件发送（密码找回令牌直达邮箱）

## 2. 技术选型

| 层       | 技术                          | 说明                         |
| -------- | ----------------------------- | ---------------------------- |
| 后端     | Node.js + Express             | 轻量 HTTP 服务，RESTful API  |
| 前端     | 原生 HTML + CSS + JavaScript  | 无框架依赖，顶栏式登录/注册   |
| 认证     | Token（SHA-256 + 随机盐）      | crypto 模块生成，存 localStorage |
| 数据存储 | JSON 文件（fs 模块读写）       | 单机场景足够，Promise 锁防并发 |
| 封面来源 | 豆瓣 CDN 直链                 | 启动时自动搜索豆瓣并保存 URL，浏览器直接加载 |
| 邮件服务 | Nodemailer + QQ SMTP          | 通过 `config.json` 配置；未配置时页面展示令牌 |
| 运行环境 | Node.js 18+                   | LTS 版本，使用内置 fetch    |

## 3. 文件结构

```
vote-book/
├── server.js              # Express 服务入口，路由定义，认证/管理员中间件，SMTP 邮件
├── package.json           # 项目依赖与启动脚本（express, nodemailer）
├── config.json            # SMTP 邮件配置（QQ 邮箱授权码）
├── data/
│   ├── books.json         # 图书数据（id, title, author, cover, description, votes）
│   ├── votes.json         # 投票记录（userId, bookId, timestamp）
│   ├── users.json         # 用户数据（id, username, email, password, salt, token, role）
│   ├── reset-tokens.json  # 密码重置 Token（email, token, expiresAt）
│   ├── votes_history.json  # 投票历史存档（archivedAt, records）
│   └── .covers-fetched    # 封面抓取完成标记（避免重复抓取）
├── public/
│   ├── index.html         # 主页面：图书列表 + 顶栏登录/注册 + 添加图书（管理员）
│   ├── style.css          # 样式：卡片布局、顶栏表单、响应式
│   └── app.js             # 前端逻辑：图书渲染、投票交互、认证流程、密码找回
└── spec.md                # 本文件
```

## 4. API 设计

### 4.1 获取所有图书

| 项目     | 内容                             |
| -------- | -------------------------------- |
| 方法     | `GET`                            |
| 路径     | `/api/books`                     |
| 认证     | 无需                             |
| 响应体   | `[{ id, title, author, cover, description, votes }, ...]` |

### 4.2 用户注册

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/register`                           |
| 请求体   | `{ "username": "...", "password": "...", "email": "..." }` |
| 校验     | 用户名 2-20 字符；密码必须为 6 位数字；邮箱格式校验且唯一 |
| 成功响应 | `201`，`{ id, username, email, token, role }` |
| 说明     | 首个注册用户自动获得 `role: "admin"`，后续为 `"user"` |

### 4.3 用户登录

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/login`                              |
| 请求体   | `{ "username": "...", "password": "..." }` |
| 成功响应 | `200`，`{ id, username, email, token, role }` |
| 错误响应 | `400` — 用户名不存在 / 密码错误             |

### 4.4 忘记密码

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/forgot-password`                    |
| 请求体   | `{ "email": "..." }`                      |
| 成功响应 | `200`，`{ message, email }`（邮件已发送）或 `{ message, resetToken, username }`（邮件未配置时返回令牌） |
| 说明     | 生成 64 位重置 Token（30 分钟有效）；已配置 SMTP 时通过 QQ 邮箱发送令牌到用户邮箱；未配置时令牌返回给前端展示 |

### 4.5 重置密码

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/reset-password`                     |
| 请求体   | `{ "token": "...", "newPassword": "..." }` |
| 校验     | 密码必须为 6 位数字；Token 一次性有效      |
| 成功响应 | `200`，`{ message, username, token, role }`（自动登录） |

### 4.6 获取当前用户投票状态

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `GET`                                     |
| 路径     | `/api/user/stats`                         |
| 认证     | `Authorization: Bearer <token>`            |
| 响应体   | `{ votesUsed, votesRemaining, votedBookIds }` |

### 4.7 为图书投票

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/vote/:id`                           |
| 认证     | `Authorization: Bearer <token>`            |
| 成功响应 | `200`，`{ book, votesRemaining }`          |
| 错误响应 | `400` — 票数已用完；`401` — 未登录；`404` — 图书不存在 |

### 4.8 搜索图书信息（管理员）

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/books/fetch-info`                   |
| 认证     | Bearer Token + admin 角色                  |
| 请求体   | `{ "title": "...", "author": "..." }`     |
| 响应体   | `{ title, author, coverUrl, description, doubanUrl }` |
| 说明     | 搜索豆瓣并返回封面 URL 和简介，不入库       |

### 4.9 刷新已有图书信息（管理员）

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/books/:id/fetch-info`               |
| 认证     | Bearer Token + admin 角色                  |
| 响应体   | 更新后的完整图书对象                       |

### 4.10 添加图书（管理员）

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/books`                              |
| 认证     | Bearer Token + admin 角色                  |
| 请求体   | `{ "title": "...", "author": "..." }`     |
| 成功响应 | `201`，新增的图书对象                       |
| 说明     | 自动从豆瓣搜索封面和简介并保存              |

### 4.11 编辑图书（管理员）

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `PUT`                                     |
| 路径     | `/api/books/:id`                          |
| 认证     | Bearer Token + admin 角色                  |
| 请求体   | `{ "title"?, "author"?, "cover"?, "description"? }`（所有字段可选） |
| 成功响应 | `200`，更新后的完整图书对象                |
| 说明     | 仅更新传入的非空字段；cover 支持手动输入 URL |

### 4.12 删除图书（管理员）

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `DELETE`                                  |
| 路径     | `/api/books/:id`                          |
| 认证     | Bearer Token + admin 角色                  |
| 成功响应 | `200`，`{ "message": "已删除《...》" }`    |
| 说明     | 同时删除 votes.json 中该书的投票记录        |

### 4.13 重置所有投票（管理员）

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| 方法     | `POST`                                    |
| 路径     | `/api/reset-votes`                        |
| 认证     | Bearer Token + admin 角色                  |
| 请求体   | `{ "archive": true|false }`（可选，默认 false） |
| 成功响应 | `200`，`{ message, booksReset, votesCleared }` |
| 说明     | 所有图书票数归零，清空 votes.json；若 archive=true 则将旧记录写入 votes_history.json |

## 5. 前端交互逻辑

```
页面加载
  └→ fetch GET /api/books（无需登录）
       └→ 渲染图书列表（封面 + 书名 + 作者 + 简介 + 总票数 + 投票按钮）
  └→ 检查 localStorage 中 token
       ├─ 有效 → 显示用户信息栏（用户名 + [管理员] 标识 + 剩余票数），投票按钮可用
       └─ 无效/无 → 显示"登录""注册"入口

顶栏登录/注册/忘记密码/重置密码
  └→ 登录模式：用户名 + 密码 + "去注册" + "忘记密码"
  └→ 注册模式：用户名 + 密码 + 邮箱 + "去登录"
  └→ 忘记密码模式：邮箱 + "发送重置令牌" + "返回登录"
  └→ 重置密码模式：令牌 + 新密码 + "返回登录"
  └→ 密码前端校验 6 位数字（pattern + inputmode）

管理员功能
  └→ 用户 role === "admin" 时，页面底部显示"添加图书"区域
  └→ 输入书名 + 作者 → 搜索并添加 → 自动从豆瓣抓取封面和简介

投票流程
  ├─ 未登录 → 顶栏直接登录/注册
  │    └→ 注册/登录成功 → 更新认证状态 → 投票按钮可用
  └─ 已登录 → POST /api/vote/:id
       ├─ 成功 → 该书票数 +1，剩余票数 -1，按钮状态更新
       │    └→ 剩余票数为 0 时所有按钮 disabled + "已投完"
       └─ 失败 → 显示错误提示，恢复按钮

密码找回流程（已配置 SMTP）
  └→ "忘记密码" → 输入注册邮箱 → 重置令牌发送到邮箱
       └→ 查收邮件 → 输入令牌 + 新密码 → 重置成功 + 自动登录
密码找回流程（未配置 SMTP）
  └→ "忘记密码" → 输入注册邮箱 → 页面显示令牌 → 复制令牌
       └→ 输入令牌 + 新密码 → 重置成功 + 自动登录
```

## 6. 数据存储方案

### books.json

```json
[
  {
    "id": 1,
    "title": "活着",
    "author": "余华",
    "cover": "https://img9.doubanio.com/view/subject/l/public/s29869926.jpg",
    "votes": 0,
    "description": "..."
  }
]
```

- 启动时若文件不存在则自动初始化 5 本预设图书（封面为空）。
- 启动后异步从豆瓣搜索并保存封面 CDN URL 和简介，完成后写入 `.covers-fetched` 标记避免重复抓取。
- 封面图片加载失败时前端显示书名首字占位图。

### votes.json

```json
[
  { "userId": 1779456652337, "bookId": 1, "timestamp": "2026-05-22T12:00:00.000Z" }
]
```

- 每次投票追加一条记录，包含投票用户 ID、图书 ID 和时间戳。
- 用户票数 = 该用户在 votes.json 中的记录数（≤3）。

### users.json

```json
[
  {
    "id": 1779456652337,
    "username": "admin",
    "email": "admin@example.com",
    "password": "<sha256 hash>",
    "salt": "<random hex>",
    "token": "<random 64-char hex>",
    "role": "admin"
  }
]
```

- 密码使用 SHA-256 + 随机盐哈希存储。
- Token 在注册和每次登录时重新生成，前端存于 localStorage。
- `role`: 首个注册用户为 `"admin"`，后续为 `"user"`。
- `email`: 必填，唯一，用于密码找回。
- **预置管理员**：系统初始化时自动创建 `admin` / `123456` 账号，无需手动注册。

### reset-tokens.json

```json
[
  { "email": "admin@example.com", "token": "<64-char hex>", "expiresAt": 1779500000000 }
]
```

- 密码重置 Token 30 分钟有效，使用后立即删除。
- 已配置 SMTP 时自动发送邮件到用户邮箱；未配置时令牌返回前端展示。
- SMTP 配置写入 `config.json`，支持 QQ/163/Gmail 等邮箱。

### votes_history.json

```json
[
  {
    "archivedAt": "2026-05-23T12:00:00.000Z",
    "records": [
      { "userId": 1, "bookId": 2, "timestamp": "..." }
    ]
  }
]
```

- 管理员重置投票时若选择"存档"，旧投票记录追加到此文件。
- 每条存档包含归档时间戳和当时的完整投票记录数组。

### 并发控制

- 所有写操作经 Promise 锁串行化，确保投票计数准确。

## 7. 后续可扩展点

| 方向         | 说明                                       |
| ------------ | ------------------------------------------ |
| 管理后台增强 | 查看投票统计（趋势/分布），用户管理         |
| 数据库升级   | SQLite / PostgreSQL 替代 JSON 文件          |
| 实时更新     | WebSocket / SSE 推送票数变化给所有在线用户  |
| 限流防刷     | 基于 IP 或用户维度的投票频率限制            |
| 排行榜       | 按票数排序展示，支持周榜/月榜               |
| 评论/书评    | 用户可对图书发表评论                       |
| 部署         | Docker 化，CI/CD，云部署                    |
| 第三方登录   | OAuth（GitHub / Google）                    |
