/**
 * dsh-reqable-mcp — Reqable 抓包 MCP 接入（标准 dsh 插件形态）。
 *
 * Reqable 自带一个 mcp-server 可执行文件，这里把它作为一台 MCP 服务器注册进宿主：
 * host/port/scope（以及 token、可执行文件路径）全部在插件设置里维护，
 * 改完即时生效——本插件监听 loader/volatile-update，重新向 ctx.mcpManager 注册，
 * manager 负责卸载旧实例、挂新实例。
 *
 * @module dsh-reqable-mcp
 */

import z from '@deepseek-ai/schemastery'

/** Loader 诊断与插件页面显示的插件名。 */
export const name = 'dsh-reqable-mcp'

/** 需要宿主提供 MCP 管理器（Web profile 默认挂载）。 */
export const inject = ['mcpManager']

/** 各平台 Reqable 自带 mcp-server 的常见位置；找不到时在设置里改成实际路径。 */
export const DEFAULT_COMMAND = process.platform === 'win32'
  ? 'C:/Program Files/Reqable/mcp-server.exe'
  : process.platform === 'darwin'
    ? '/Applications/Reqable.app/Contents/MacOS/mcp-server'
    : '/usr/share/reqable/mcp-server'

/** 字段默认值：schema 默认与文档共用一份。 */
export const DEFAULTS = {
  enabled: true,
  serverName: 'reqable',
  command: DEFAULT_COMMAND,
  host: '127.0.0.1',
  port: 9000,
  scope: 'all',
  token: '',
  startupTimeoutMs: 30000,
  toolCallTimeoutMs: 60000,
}

/**
 * 插件配置。整体 volatile：任何字段改动都不重启 Host，只重新注册这台服务器。
 * token 标记 role('secret')，Settings 只回传「是否已设置」，不会把明文回读到浏览器。
 */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled),
  serverName: z.string().default(DEFAULTS.serverName),
  command: z.string().default(DEFAULTS.command),
  host: z.string().default(DEFAULTS.host),
  port: z.number().step(1).min(1).max(65535).default(DEFAULTS.port),
  scope: z.string().default(DEFAULTS.scope),
  token: z.string().role('secret').default(DEFAULTS.token),
  startupTimeoutMs: z.number().step(1).min(1).default(DEFAULTS.startupTimeoutMs),
  toolCallTimeoutMs: z.number().step(1).min(1).default(DEFAULTS.toolCallTimeoutMs),
}).default(DEFAULTS).volatile()

/**
 * 取出配置的普通对象形态（volatile 引用带 get()，普通对象也接受）。
 * @param value - volatile 引用或已解析配置。
 * @returns 字段齐全的普通对象。
 */
export function resolvedOf(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value ?? {}
}

/**
 * 把一份已解析的配置翻成 mcp-manager 的服务器条目。
 * @param config - volatile 引用或已解析配置。
 * @returns dsh-mcp-manager 的 stdio 条目。
 */
export function entryFor(config) {
  const settings = { ...DEFAULTS, ...resolvedOf(config) }
  const entry = {
    transport: 'stdio',
    command: settings.command,
    args: ['--host', settings.host, '--port', String(settings.port), '--scope', settings.scope],
    startupTimeoutMs: settings.startupTimeoutMs,
    toolCallTimeoutMs: settings.toolCallTimeoutMs,
  }
  if (settings.token !== '') entry.env = { REQABLE_TOKEN: settings.token }
  return entry
}

/**
 * 挂载插件：注册（或按设置重建）Reqable MCP 服务器。
 * @param ctx - 插件上下文，带 mcpManager。
 * @param config - volatile 配置引用。
 */
export function apply(ctx, config) {
  let unregister

  const withdraw = () => {
    if (unregister === undefined) return
    const dispose = unregister
    unregister = undefined
    dispose()
  }

  const sync = () => {
    withdraw()
    const settings = { ...DEFAULTS, ...resolvedOf(config) }
    if (settings.enabled === false) return
    try {
      unregister = ctx.mcpManager.register(settings.serverName, entryFor(settings))
    } catch (error) {
      ctx.logger.warn('dsh-reqable-mcp: 注册 MCP 服务器失败：%s', error instanceof Error ? error.message : String(error))
    }
  }

  ctx.effect(() => {
    sync()
    return withdraw
  }, 'dsh-reqable-mcp: mcp server registration')

  ctx.on('loader/volatile-update', () => { sync() })
}
