import { appConfig } from '@/config'

/**
 * 经统一入口发起请求并解包响应。
 * @param {Object} options 请求路径、方法和数据。
 * @returns {Promise<unknown>} 接口业务数据。
 */
export default async function request(options) {
  const method = (options.method || 'get').toUpperCase()
  const path = options.url.replace(/^\/+/, '')
  const isAbsoluteUrl = /^https?:\/\//i.test(options.url)
  if (isAbsoluteUrl) {
    throw new Error('请求地址必须使用功能相对路径')
  }
  const url = `${appConfig.apiBaseUrl.replace(/\/+$/, '')}/${path}`
  const controller = new AbortController()
  const abortRequest = () => controller.abort()
  if (options.signal?.aborted) abortRequest()
  else options.signal?.addEventListener('abort', abortRequest, { once: true })
  const timer = setTimeout(() => controller.abort(), appConfig.requestTimeout)
  const isForm = options.data instanceof FormData
  const headers = isForm ? {} : { 'Content-Type': 'application/json' }
  try {
    const response = await fetch(url, {
      method,
      headers,
      body:
        options.data === undefined
          ? undefined
          : isForm
            ? options.data
            : JSON.stringify(options.data),
      signal: controller.signal,
    })
    const raw = await response.text()
    let payload
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      throw new Error(`服务返回了无法解析的内容（HTTP ${response.status}）`)
    }
    const hasEnvelope =
      payload !== null && typeof payload === 'object' && typeof payload.code === 'number'
    if (!response.ok || (hasEnvelope && payload.code !== 0)) {
      const message = payload?.msg || payload?.error || '请求失败'
      throw new Error(message + (payload?.detail ? `：${payload.detail}` : ''))
    }
    if (!hasEnvelope) {
      throw new Error('服务响应缺少统一信封')
    }
    return payload.data
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortRequest)
  }
}
