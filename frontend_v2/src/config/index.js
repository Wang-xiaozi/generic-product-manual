// 集中读取离线运行配置。
export const appConfig = Object.freeze({
  apiBaseUrl: window.__APP_CONFIG__.apiBaseUrl,
  requestTimeout: window.__APP_CONFIG__.requestTimeout,
  snpDirectoryPath: window.__APP_CONFIG__.snpDirectoryPath,
})
