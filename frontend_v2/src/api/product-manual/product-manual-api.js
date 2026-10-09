import request from '@/utils/request.js'
import { appConfig } from '@/config'

const prefix = 'product-manual'

/**
 * 生成由后端提供的手册模板下载地址。
 * @param {string} templateName 模板文件名。
 * @returns {string} 模板下载地址。
 */
export function getTemplateDownloadUrl(templateName) {
  const apiBaseUrl = appConfig.apiBaseUrl.replace(/\/+$/, '')
  return `${apiBaseUrl}/${prefix}/templates/${encodeURIComponent(templateName)}`
}

/**
 * 发送手册对话。
 * @param {Object} payload 含 messages 的请求。
 * @returns {Promise<Object>} 模型回复。
 */
export function sendManualChat(payload) {
  return request({ url: `${prefix}/agent/chat`, method: 'post', data: payload })
}

/**
 * 生成版图产物。
 * @param {FormData} formData 含 tdb_file 的上传数据。
 * @returns {Promise<Object>} 图像、场景与压点表数据。
 */
export function generateLayoutAssets(formData) {
  return request({
    url: `${prefix}/layout/generate-layout-assets`,
    method: 'post',
    data: formData,
  })
}

/**
 * 将旧页面接口路径映射到本功能接口。
 * @param {string} path 原页面使用的接口路径。
 * @param {Object} options 请求方法和 JSON 数据。
 * @returns {Promise<Object>} 解包后的业务数据。
 */
export function requestLegacy(path, options = {}) {
  const routeMap = {
    '/api/agent/config': `${prefix}/agent/config`,
    '/api/agent/test': `${prefix}/agent/test`,
    '/api/agent/chat': `${prefix}/agent/chat`,
  }
  const url = routeMap[path]
  if (!url) return Promise.reject(new Error(`未知接口：${path}`))
  return request({
    url,
    method: options.method || 'get',
    data: options.body ? JSON.parse(options.body) : undefined,
    signal: options.signal,
  })
}
