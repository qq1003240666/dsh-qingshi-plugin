// 对应小程序端 utils/request.js 里的 buildResult(code, message, data = null)。
export function buildResult(code, message, data = null) {
  return { code, message, data }
}

export function isLoginExpired(result) {
  return Boolean(result && (result.code === 401 || result.code === 403))
}
