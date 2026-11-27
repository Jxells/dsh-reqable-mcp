# dsh-reqable-mcp

Reqable 抓包 MCP 接入，按 **dsh 标准插件**形态重写：一个 Cordis 插件 + 一份 schemastery `Config`，
可执行文件路径、host/port/scope、token 全部在 **Settings → 插件** 里改，改完即时生效。

旧版（`@local/reqable-mcp`）把 `dsh-mcp-client` 的一行 YAML 写死在包内，换端口/换机器就得改文件重启。
这版把连接参数搬进设置，并且交给宿主的 `ctx.mcpManager` 管理实例。

## 它做什么

- 注册一台 MCP 服务器（`serverName` 默认 `reqable`），工具名 `mcp__reqable__*`
- 用 `command --host H --port P --scope S` 启动 Reqable 自带的 mcp-server，token 走 `REQABLE_TOKEN`
- 设置项全部 `volatile`：改动只重建这台服务器，不重启 Host；`token` 是 `role('secret')`，界面不回读明文

## 架构

```
Settings ──► Config schema (schemastery) ──► 写入 profile 补丁层
                                                   │
dsh-reqable-mcp.apply(ctx, config) ──► ctx.mcpManager.register('reqable', entry)
                                                   │
                              dsh-mcp-manager → dsh-mcp-client → reqable mcp-server
```

刻意不 import 任何 dsh 内部包（除了 npm 上的 `@deepseek-ai/schemastery`）：profile 里安装的第三方插件
解析不到 `@deepseek-ai/*`（它们只在全局 dsh 安装目录里），import 了会在启动时无声失败。

## 安装

```bash
node scripts/install.mjs                 # 装进 web profile，并从旧版迁移 host/port/scope/token
node scripts/install.mjs --profile tui
node scripts/install.mjs --from git+https://github.com/USER/dsh-reqable-mcp.git
```

装完重启一次 `dsh`（`~/dsh.sh`）；之后改设置不用再重启。

## 设置

Settings → 插件 → **Reqable 抓包连接**：`enabled`、`serverName`、`command`、`host`、`port`、`scope`、
`token`、`startupTimeoutMs`、`toolCallTimeoutMs`，逐项含义见 [docs/DETAIL.md](docs/DETAIL.md)。

写入 profile 补丁层后形如：

```yaml
- id: reqable-mcp
  name: dsh-reqable-mcp
  config:
    host: 127.0.0.1
    port: 9000
    scope: all
    token: '<Reqable token>'
```

## 开发

```bash
pnpm install
pnpm test
```

## 发布到自己的 git

```bash
bash scripts/publish.sh git@github.com:USER/dsh-reqable-mcp.git
```

## License

MIT
