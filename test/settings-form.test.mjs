/**
 * 设置表单投影测试：证明宿主 dsh-settings 能把这层 `Config` 投影成可编辑表单，
 * 并且 secret 字段不会以明文进入浏览器。
 *
 *   DSH_INSTALL_DIR=~/.nvm/versions/node/v24.22.3/lib/node_modules/@deepseek-ai/dsh \
 *     node --test test/settings-form.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Config, resolvedOf } from '../index.js'

const installDir = process.env.DSH_INSTALL_DIR
const helper = (file) => pathToFileURL(join(installDir, 'node_modules', '@deepseek-ai', 'dsh-settings', 'lib', 'types', file)).href

test('Config 能投影成设置表单', { skip: installDir === undefined && '未设置 DSH_INSTALL_DIR' }, async () => {
  const { volatileForm, projectForm, plainConfig } = await import(helper('schema.js'))
  const form = volatileForm(Config)
  assert.ok(form !== undefined, 'Config 没有可编辑字段：设置页面会是空的')

  const value = plainConfig(resolvedOf(Config({ token: 'secret-value' })))
  const projected = projectForm(form, value)
  assert.ok('token' in projected, 'secret 字段没有进入表单 schema')
  assert.equal(typeof form.toJSON, 'function')
})

test('secret 字段在回传前被抹掉', { skip: installDir === undefined && '未设置 DSH_INSTALL_DIR' }, async () => {
  const { volatileForm, plainConfig } = await import(helper('schema.js'))
  const { redactSecrets } = await import(helper('redact.js'))
  const form = volatileForm(Config)
  const redacted = redactSecrets(form, plainConfig(resolvedOf(Config({ token: 'secret-value' }))))

  assert.equal(redacted.value['token'], undefined, '明文 secret 不应出现在回传值里')
  const slot = redacted.secrets.find((entry) => entry.path.join('.') === 'token')
  assert.ok(slot !== undefined, 'secret 位置没有被登记')
  assert.equal(slot.set, true)
})
