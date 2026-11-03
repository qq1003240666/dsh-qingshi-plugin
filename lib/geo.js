// 地址服务：搜索地名、反查地址、按 IP 猜个大概位置。
//
// 坐标一律按 GCJ-02（国内地图通用的火星坐标）保存，因为青史小程序里
// uni.chooseLocation 给出的就是 GCJ-02，混着 WGS-84 会整体偏几百米。
//
// 两条路：
//   · 配了 amapKey  → 走高德 Web 服务（搜索/逆地理/IP 定位，最准，需要免费 key）
//   · 没配 key      → 走高德瓦片 + Photon(OpenStreetMap) 搜索，再把 WGS-84 转成 GCJ-02
const PI = Math.PI
const AXIS = 6378245.0
const ECCENTRICITY = 0.00669342162296594323

const outOfChina = (lat, lng) =>
  !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

export function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return { latitude: lat, longitude: lng }
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - ECCENTRICITY * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI)
  return { latitude: lat + dLat, longitude: lng + dLng }
}

export function gcj02ToWgs84(lat, lng) {
  if (outOfChina(lat, lng)) return { latitude: lat, longitude: lng }
  let guess = { latitude: lat, longitude: lng }
  // 反解没有闭式解，迭代几次就够精度（米级）
  for (let i = 0; i < 4; i += 1) {
    const forward = wgs84ToGcj02(guess.latitude, guess.longitude)
    guess = {
      latitude: guess.latitude + (lat - forward.latitude),
      longitude: guess.longitude + (lng - forward.longitude),
    }
  }
  return guess
}

const round = (value) => Math.round(Number(value) * 1e6) / 1e6

// Photon 会把藏文/英文原名一起吐出来（「九寨沟县 གཟི་རྩ་སྡེ་དགུ་རྫོང།」），
// 在地点名称这种小输入框里太吵，有中文就只留中文。
function cleanName(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (!/[\u4e00-\u9fa5]/.test(text)) return text
  const stripped = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()·\-\s]/g, '').trim()
  return stripped || text
}

async function readJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`返回的不是 JSON：${text.slice(0, 120)}`)
  }
}

function pickAddress(parts) {
  const flat = []
  for (const part of parts) {
    // Photon 常把当地文字（藏文、维吾尔文等）和中文拼在一起，地址栏里留着就是
    // 一堆看不懂的符号，能认出中文/英文的部分就够了。
    const raw = String(part || '').trim()
    if (!raw) continue
    let text = raw
    if (/[\u4e00-\u9fa5]/.test(raw)) {
      text = raw.replace(/[^\u4e00-\u9fa5A-Za-z0-9（）()·\-\s]/g, '').trim()
    } else if (!/^[\x20-\x7e]+$/.test(raw)) {
      text = ''
    }
    if (!text) continue
    if (flat.includes(text)) continue
    flat.push(text)
  }
  return flat.join('')
}

// 搜索结果里常有「九寨沟县」出现两次只差一点坐标，压掉重复项
function dedupe(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = `${item.name}|${item.address}`
    if (!item.name || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export function createGeocoder({ amapKey = '', fetchImpl = globalThis.fetch, logger, timeoutMs = 8000 } = {}) {
  const key = String(amapKey || '').trim()
  let ipCache = null

  const request = async (url) => {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'dsh-qingshi/0.4 (local editor)', accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return readJson(res)
  }

  async function amapSearch(query) {
    const url =
      `https://restapi.amap.com/v3/place/text?key=${encodeURIComponent(key)}` +
      `&keywords=${encodeURIComponent(query)}&offset=8&page=1&extensions=base&citylimit=false`
    const data = await request(url)
    if (String(data.status) !== '1') throw new Error(`高德搜索失败：${data.info || '未知错误'}`)
    return (data.pois || []).map((poi) => {
      const [lng, lat] = String(poi.location || '').split(',').map(Number)
      return {
        name: String(poi.name || ''),
        address: pickAddress([poi.pname, poi.cityname, poi.adname, poi.address]),
        latitude: round(lat),
        longitude: round(lng),
        source: 'amap',
      }
    }).filter((item) => Number.isFinite(item.latitude) && item.latitude !== 0)
  }

  async function photonSearch(query, limit = 8) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=default`
    const data = await request(url)
    return (data.features || []).map((feature) => {
      const [lng, lat] = feature.geometry?.coordinates || []
      const props = feature.properties || {}
      const gcj = wgs84ToGcj02(Number(lat), Number(lng))
      return {
        name: cleanName(props.name || props.street || props.city || ''),
        address: pickAddress([
          props.country === '中国' ? '' : props.country,
          props.state,
          props.county || props.city,
          props.district,
          props.street,
          props.housenumber,
        ]),
        latitude: round(gcj.latitude),
        longitude: round(gcj.longitude),
        source: 'photon',
      }
    }).filter((item) => item.name && Number.isFinite(item.latitude))
  }

  async function amapReverse(lat, lng) {
    const url =
      `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}` +
      `&location=${round(lng)},${round(lat)}&extensions=base`
    const data = await request(url)
    if (String(data.status) !== '1') throw new Error(`高德反查失败：${data.info || '未知错误'}`)
    const regeo = data.regeocode || {}
    const comp = regeo.addressComponent || {}
    return {
      name: cleanName(comp.township || comp.district || comp.city || ''),
      address: String(regeo.formatted_address || ''),
      source: 'amap',
    }
  }

  async function photonReverse(lat, lng) {
    const wgs = gcj02ToWgs84(lat, lng)
    const url = `https://photon.komoot.io/reverse?lat=${round(wgs.latitude)}&lon=${round(wgs.longitude)}&lang=default`
    const data = await request(url)
    const feature = (data.features || [])[0]
    if (!feature) return { name: '', address: '', source: 'photon' }
    const props = feature.properties || {}
    return {
      name: cleanName(props.name || props.street || props.city || ''),
      address: pickAddress([
        props.country === '中国' ? '' : props.country,
        props.state,
        props.county || props.city,
        props.district,
        props.street,
        props.housenumber,
      ]),
      source: 'photon',
    }
  }

  async function ipCity() {
    if (ipCache) return ipCache
    try {
      const data = await request('https://myip.ipip.net/json')
      const location = data?.data?.location || []
      ipCache = { city: String(location[2] || location[1] || ''), ip: String(data?.data?.ip || '') }
    } catch (error) {
      logger?.(`IP 定位失败：${error.message}`)
      ipCache = { city: '', ip: '' }
    }
    return ipCache
  }

  return {
    provider: () => (key ? 'amap' : 'photon'),
    async search(query) {
      const text = String(query || '').trim()
      if (!text) return []
      if (key) {
        try {
          const list = await amapSearch(text)
          if (list.length) return dedupe(list)
        } catch (error) {
          logger?.(`高德搜索不可用，改用 Photon：${error.message}`)
        }
      }
      return dedupe(await photonSearch(text))
    },
    async reverse(latitude, longitude) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { name: '', address: '' }
      if (key) {
        try {
          return await amapReverse(latitude, longitude)
        } catch (error) {
          logger?.(`高德反查不可用，改用 Photon：${error.message}`)
        }
      }
      try {
        return await photonReverse(latitude, longitude)
      } catch (error) {
        logger?.(`地址反查失败：${error.message}`)
        return { name: '', address: '' }
      }
    },
    // 打开地图时的默认中心：优先用高德 IP 定位（准到区），否则用 IP 城市名去搜一个坐标
    async ipLocation() {
      if (key) {
        try {
          const data = await request(`https://restapi.amap.com/v3/ip?key=${encodeURIComponent(key)}`)
          const rect = String(data.rectangle || '')
          const [sw, ne] = rect.split(';')
          if (sw && ne) {
            const [swLng, swLat] = sw.split(',').map(Number)
            const [neLng, neLat] = ne.split(',').map(Number)
            return {
              city: String(data.city || data.province || ''),
              latitude: round((swLat + neLat) / 2),
              longitude: round((swLng + neLng) / 2),
              source: 'amap',
            }
          }
        } catch (error) {
          logger?.(`高德 IP 定位不可用：${error.message}`)
        }
      }
      const { city, ip } = await ipCity()
      if (!city) return { city: '', latitude: 0, longitude: 0, source: 'none', ip }
      try {
        const hits = await photonSearch(city, 1)
        if (hits.length) return { city, latitude: hits[0].latitude, longitude: hits[0].longitude, source: 'photon', ip }
      } catch (error) {
        logger?.(`IP 城市定位失败：${error.message}`)
      }
      return { city, latitude: 0, longitude: 0, source: 'city-only', ip }
    },
  }
}
