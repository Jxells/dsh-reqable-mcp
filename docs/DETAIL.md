# Reqable 抓包连接

通过 Reqable 自带的 `mcp-server`（stdio）把抓包能力接入 Agent。连接参数（可执行文件路径、host、port、scope、token）
全部在**插件设置**里维护，改完即时生效。

## 能做什么

- 读实时抓包记录：`capture_live_status`、`capture_record_filter`、`capture_record_get_by_id`、`capture_record_generate_curl`
- 开关实时抓包、清空记录：`capture_live_set_enabled`、`capture_live_clear`
- 读写断点 / 重写 / 网关 / 镜像 / 脚本 / 反向代理 / 二级代理 / SSL 代理规则 / 限速 / 上报服务器
- 在 Collection 里创建、更新 API，或把某条记录合成到新标签页

工具名统一带前缀 `mcp__reqable__`，前缀里的 `reqable` 就是设置里的「工具命名空间」（`serverName`）。

## 设置项

Settings → 插件 → Reqable 抓包连接。命名空间是本插件的条目 id：`reqable-mcp`。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉即撤回这台 MCP 服务器 |
| `serverName` | `reqable` | 工具命名空间，`[A-Za-z0-9_-]{1,32}`，全局唯一 |
| `command` | 按平台推断 | Reqable 自带 mcp-server 的绝对路径；Linux 常见 `/usr/share/reqable/mcp-server`，Windows `C:/Program Files/Reqable/mcp-server.exe` |
| `host` | `127.0.0.1` | Reqable 的 API/代理所在主机；抓手机的包时可填手机 IP |
| `port` | `9000` | Reqable API 端口（即 `capture_config` 里的 `proxyPort`） |
| `scope` | `all` | 暴露哪些 MCP 能力，交给 mcp-server 的 `--scope` |
| `token` | 空 | Reqable 的访问 token，作为 `REQABLE_TOKEN` 传给子进程；`role('secret')`，界面不回读明文 |
| `startupTimeoutMs` | `30000` | 单次连接 + 首次工具同步预算 |
| `toolCallTimeoutMs` | `60000` | 单次工具调用预算 |

实现上就是把设置拼成：

```
command --host <host> --port <port> --scope <scope>
env: REQABLE_TOKEN=<token>
```

## 抓手机上的 Reqable

两种方式：

1. `host` 直接填手机在局域网的 IP（手机与电脑同一网段，Reqable 允许远程访问）；
2. 手机 USB 连电脑，先 `adb forward tcp:9000 tcp:9000`，`host` 保持 `127.0.0.1`。

## 故障排查

| 现象 | 先看这里 |
|---|---|
| 工具不在列表里 | Settings → MCP 服务器 页查看 `reqable` 状态；`failed` 时看 `~/dsh.log` |
| `spawn ... ENOENT` | `command` 路径不对：`ls -l /usr/share/reqable/mcp-server` 确认真实位置后填进设置 |
| 连上了但没有记录 | Reqable 里实时抓包是否开着；`port` 是否等于 Reqable 设置里的 API 端口 |
| 401/无法认证 | `token` 与 Reqable 里显示的不一致时重填（旧 token 会随 Reqable 重启变化） |
