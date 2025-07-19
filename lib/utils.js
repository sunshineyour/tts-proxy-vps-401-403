import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  selectRandomRegion,
  buildDynamicProxyAuth,
  getRegionsStats,
  validateRegionsData
} from './region-manager.js';

// 【环境变量】确保.env文件被加载（避免重复加载的安全调用）
if (!process.env.DOTENV_LOADED) {
  dotenv.config();
  process.env.DOTENV_LOADED = 'true';
}

// 【浏览器指纹模拟】画像池数据结构
// 每个画像包含完整且内部一致的浏览器指纹信息
const BROWSER_PROFILES = [
  {
    id: 'chrome_125_windows',
    name: 'Chrome 125 on Windows 11',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://elevenlabs.io/',
      'Origin': 'https://elevenlabs.io',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    }
  },
  {
    id: 'chrome_124_windows',
    name: 'Chrome 124 on Windows 10',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://elevenlabs.io/',
      'Origin': 'https://elevenlabs.io',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    }
  },
  {
    id: 'firefox_126_windows',
    name: 'Firefox 126 on Windows 11',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://elevenlabs.io/',
      'Origin': 'https://elevenlabs.io',
      'DNT': '1',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site'
    }
  },
  {
    id: 'safari_17_macos',
    name: 'Safari 17 on macOS Sonoma',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://elevenlabs.io/',
      'Origin': 'https://elevenlabs.io',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site'
    }
  },
  {
    id: 'edge_125_windows',
    name: 'Microsoft Edge 125 on Windows 11',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
      'sec-ch-ua': '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://elevenlabs.io/',
      'Origin': 'https://elevenlabs.io',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    }
  }
];

// 【会话管理】存储当前活跃的会话画像
const activeSessions = new Map();

// 【行为模拟】配置参数
const BEHAVIOR_CONFIG = {
  // 请求间随机延迟范围（毫秒）
  minDelay: 800,
  maxDelay: 2500,
  // 会话持续时间（毫秒）- 在此时间内保持同一画像
  sessionDuration: 300000, // 5分钟
  // 错误重试延迟倍数
  retryDelayMultiplier: 2,
  // 最大重试延迟（毫秒）
  maxRetryDelay: 10000
};

// 【画像选择】为会话选择或获取浏览器画像
function getBrowserProfileForSession(sessionId) {
  const now = Date.now();

  // 检查是否已有活跃会话
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);

    // 检查会话是否过期
    if (now - session.startTime < BEHAVIOR_CONFIG.sessionDuration) {
      console.log(`[FINGERPRINT] 🔄 Using existing profile for session ${sessionId}: ${session.profile.name}`);
      return session.profile;
    } else {
      // 会话过期，清理
      activeSessions.delete(sessionId);
      console.log(`[FINGERPRINT] ⏰ Session ${sessionId} expired, selecting new profile`);
    }
  }

  // 选择新的随机画像
  const randomIndex = Math.floor(Math.random() * BROWSER_PROFILES.length);
  const selectedProfile = BROWSER_PROFILES[randomIndex];

  // 创建新会话
  activeSessions.set(sessionId, {
    profile: selectedProfile,
    startTime: now,
    requestCount: 0
  });

  console.log(`[FINGERPRINT] 🎭 New session ${sessionId} assigned profile: ${selectedProfile.name}`);
  console.log(`[FINGERPRINT] 📊 Active sessions: ${activeSessions.size}`);

  return selectedProfile;
}

// 【随机延迟】模拟人类行为的请求间隔
function getRandomDelay(isRetry = false, retryCount = 0) {
  if (isRetry) {
    // 重试时使用指数退避
    const baseDelay = Math.min(
      BEHAVIOR_CONFIG.minDelay * Math.pow(BEHAVIOR_CONFIG.retryDelayMultiplier, retryCount),
      BEHAVIOR_CONFIG.maxRetryDelay
    );
    const jitter = baseDelay * 0.3 * Math.random(); // 添加30%的随机抖动
    return Math.floor(baseDelay + jitter);
  } else {
    // 正常请求的随机延迟
    const { minDelay, maxDelay } = BEHAVIOR_CONFIG;
    return Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);
  }
}

// 【会话清理】定期清理过期会话
function cleanupExpiredSessions() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.startTime >= BEHAVIOR_CONFIG.sessionDuration) {
      activeSessions.delete(sessionId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[FINGERPRINT] 🧹 Cleaned up ${cleanedCount} expired sessions`);
  }
}

// 【会话ID生成】基于请求特征生成会话标识
function generateSessionId(voiceId, requestBody) {
  // 使用voiceId和请求体的部分内容生成会话ID
  // 这样相同类型的请求会复用同一个会话画像
  const bodyHash = crypto
    .createHash('md5')
    .update(requestBody.substring(0, 100)) // 只使用前100个字符避免过长
    .digest('hex')
    .substring(0, 8);

  return `${voiceId}_${bodyHash}`;
}

// 定期清理过期会话（每5分钟执行一次）
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

// 【并发控制管理器】防止资源竞争和过载
class ConcurrencyManager {
  constructor(options = {}) {
    this.activeRequests = new Map(); // voiceId -> Set<requestId>
    this.maxConcurrentPerVoice = options.maxConcurrentPerVoice || 3;
    this.requestCounter = 0;
    // 【并发控制开关】可以通过环境变量控制，默认禁用
    this.concurrencyEnabled = options.concurrencyEnabled === true ||
                              (process.env.ENABLE_CONCURRENCY_CONTROL === 'true');
    this.stats = {
      totalRequests: 0,
      activeRequests: 0,
      rejectedRequests: 0
    };

    // 记录并发控制状态
    console.log(`[CONCURRENCY] 🎛️ Concurrency control: ${this.concurrencyEnabled ? 'ENABLED' : 'DISABLED'}`);
    if (!this.concurrencyEnabled) {
      console.log(`[CONCURRENCY] ⚠️ WARNING: Concurrency limits are disabled - unlimited concurrent requests allowed`);
    }
  }

  generateRequestId() {
    return `req_${Date.now()}_${++this.requestCounter}`;
  }

  canProcessRequest(voiceId) {
    // 【并发控制开关】如果禁用，直接允许所有请求
    if (!this.concurrencyEnabled) {
      console.log(`[CONCURRENCY] ✅ Request allowed for ${voiceId} (concurrency control disabled)`);
      return true;
    }

    const activeCount = this.activeRequests.get(voiceId)?.size || 0;
    const canProcess = activeCount < this.maxConcurrentPerVoice;

    if (!canProcess) {
      this.stats.rejectedRequests++;
      console.warn(`[CONCURRENCY] 🚫 Request rejected for ${voiceId} (${activeCount}/${this.maxConcurrentPerVoice} active)`);
    }

    return canProcess;
  }

  startRequest(voiceId, requestId) {
    // 【统计信息】无论是否启用并发控制，都记录统计信息（用于监控）
    if (!this.activeRequests.has(voiceId)) {
      this.activeRequests.set(voiceId, new Set());
    }

    this.activeRequests.get(voiceId).add(requestId);
    this.stats.totalRequests++;
    this.stats.activeRequests++;

    const activeCount = this.activeRequests.get(voiceId).size;

    // 【日志优化】根据并发控制状态显示不同的日志
    if (this.concurrencyEnabled) {
      console.log(`[CONCURRENCY] 🚀 Started ${requestId} for ${voiceId} (${activeCount}/${this.maxConcurrentPerVoice})`);
    } else {
      console.log(`[CONCURRENCY] 📊 Tracking ${requestId} for ${voiceId} (${activeCount} active, no limits)`);
    }
  }

  finishRequest(voiceId, requestId) {
    const requests = this.activeRequests.get(voiceId);
    if (requests) {
      requests.delete(requestId);
      this.stats.activeRequests--;

      const activeCount = requests.size;

      if (requests.size === 0) {
        this.activeRequests.delete(voiceId);
      }

      // 【日志优化】根据并发控制状态显示不同的日志
      if (this.concurrencyEnabled) {
        console.log(`[CONCURRENCY] ✅ Finished ${requestId} for ${voiceId} (${activeCount}/${this.maxConcurrentPerVoice})`);
      } else {
        console.log(`[CONCURRENCY] 📊 Completed ${requestId} for ${voiceId} (${activeCount} remaining)`);
      }
    }
  }

  getStats() {
    const voiceStats = {};
    for (const [voiceId, requests] of this.activeRequests.entries()) {
      voiceStats[voiceId] = requests.size;
    }

    return {
      ...this.stats,
      activeByVoice: voiceStats,
      totalActiveVoices: this.activeRequests.size
    };
  }

  // 获取详细的并发状态
  getDetailedStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      configuration: {
        maxConcurrentPerVoice: this.maxConcurrentPerVoice,
        concurrencyEnabled: this.concurrencyEnabled
      },
      statistics: this.getStats(),
      activeRequests: {}
    };

    // 详细的活跃请求信息
    for (const [voiceId, requests] of this.activeRequests.entries()) {
      status.activeRequests[voiceId] = Array.from(requests);
    }

    return status;
  }
}

// 创建全局并发管理器实例（默认禁用并发控制）
const concurrencyManager = new ConcurrencyManager({
  maxConcurrentPerVoice: parseInt(process.env.MAX_CONCURRENT_PER_VOICE) || 3,
  concurrencyEnabled: process.env.ENABLE_CONCURRENCY_CONTROL === 'true' // 默认禁用，需要显式启用
});

// 【电路熔断器】自动故障检测和恢复
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 30000; // 30秒
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10秒

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.requestCount = 0;
    this.lastRequestTime = null;

    // 统计信息
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      circuitOpenCount: 0,
      lastStateChange: Date.now()
    };
  }

  async execute(operation) {
    this.requestCount++;
    this.stats.totalRequests++;
    this.lastRequestTime = Date.now();

    // 检查电路状态
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this._changeState('HALF_OPEN');
        this.successCount = 0;
        console.log('[CIRCUIT] 🔄 State changed to HALF_OPEN - attempting recovery');
      } else {
        const remainingTime = Math.ceil((this.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000);
        console.warn(`[CIRCUIT] ⛔ Circuit breaker is OPEN - retry in ${remainingTime}s`);
        throw new Error(`Circuit breaker is OPEN - retry in ${remainingTime} seconds`);
      }
    }

    try {
      const result = await operation();

      // 成功处理
      this.stats.totalSuccesses++;

      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= 2) { // 需要连续2次成功才恢复
          this._changeState('CLOSED');
          this.failures = 0;
          console.log('[CIRCUIT] ✅ State changed to CLOSED - circuit recovered');
        }
      }

      return result;
    } catch (error) {
      // 失败处理
      this.failures++;
      this.stats.totalFailures++;
      this.lastFailureTime = Date.now();

      console.error(`[CIRCUIT] ❌ Operation failed (${this.failures}/${this.failureThreshold}):`, error.message);

      if (this.failures >= this.failureThreshold && this.state !== 'OPEN') {
        this._changeState('OPEN');
        this.stats.circuitOpenCount++;
        console.error('[CIRCUIT] 🔴 State changed to OPEN - circuit breaker activated');
      }

      throw error;
    }
  }

  _changeState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.stats.lastStateChange = Date.now();
    console.log(`[CIRCUIT] 🔄 Circuit breaker state: ${oldState} → ${newState}`);
  }

  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      successCount: this.successCount,
      requestCount: this.requestCount,
      lastFailureTime: this.lastFailureTime,
      lastRequestTime: this.lastRequestTime,
      configuration: {
        failureThreshold: this.failureThreshold,
        resetTimeout: this.resetTimeout,
        monitoringPeriod: this.monitoringPeriod
      },
      statistics: { ...this.stats }
    };
  }

  // 手动重置电路熔断器
  reset() {
    this._changeState('CLOSED');
    this.failures = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    console.log('[CIRCUIT] 🔄 Circuit breaker manually reset');
  }

  // 检查电路健康状况
  isHealthy() {
    return this.state === 'CLOSED' || this.state === 'HALF_OPEN';
  }
}

// 创建全局电路熔断器实例
const elevenLabsCircuitBreaker = new CircuitBreaker({
  failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 3,
  resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 30000,
  monitoringPeriod: 10000
});

// 【导出函数】供演示和测试使用
export {
  getBrowserProfileForSession,
  getRandomDelay,
  generateSessionId,
  BROWSER_PROFILES,
  concurrencyManager,
  elevenLabsCircuitBreaker,
  activeSessions
};

// 【SSL配置】针对代理环境的SSL设置
// 这是解决代理服务器SSL证书链问题的标准做法
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.log('[PROXY] 🔧 已设置SSL兼容模式以支持代理服务器');
  console.log('[PROXY] ℹ️  注意：Node.js会显示TLS警告，这是正常的代理配置，可以忽略');
}

// 【代理配置】IP代理设置
// 支持环境变量配置，便于部署时灵活切换
function getProxyConfig() {
  const PROXY_IP = process.env.PROXY_IP;
  const PROXY_PORT = process.env.PROXY_PORT;
  const PROXY_USERNAME = process.env.PROXY_USERNAME;
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

  // 【配置验证】检查必需的代理配置
  if (!PROXY_IP || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    console.error('[PROXY] ❌ 代理配置不完整！');
    console.error('[PROXY] 📋 请设置以下环境变量:');
    console.error('[PROXY]    PROXY_IP=你的代理IP');
    console.error('[PROXY]    PROXY_PORT=你的代理端口');
    console.error('[PROXY]    PROXY_USERNAME=你的用户名');
    console.error('[PROXY]    PROXY_PASSWORD=你的密码');
    console.error('[PROXY] 💡 可以使用 .env 文件或直接设置环境变量');
    throw new Error('Proxy configuration incomplete');
  }

  return { PROXY_IP, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD };
}

// 【动态地区代理配置】支持动态地区切换的代理配置
// 根据环境变量决定是否启用动态地区功能
export function getDynamicProxyConfig() {
  // 检查是否启用动态地区功能
  const enableDynamicRegions = process.env.ENABLE_DYNAMIC_REGIONS === 'true';

  if (!enableDynamicRegions) {
    console.log('[REGION] 📋 Dynamic regions disabled, using static proxy config with global suffix');
    // 获取基础配置并添加-global后缀
    const baseConfig = getProxyConfig();
    return {
      PROXY_IP: baseConfig.PROXY_IP,
      PROXY_PORT: baseConfig.PROXY_PORT,
      PROXY_USERNAME: baseConfig.PROXY_USERNAME,
      PROXY_PASSWORD: baseConfig.PROXY_PASSWORD + '-global',
      SELECTED_REGION: null // 静态模式没有选中的地区
    };
  }

  // 获取基础代理配置
  const baseConfig = getProxyConfig();

  // 验证地区数据
  const validation = validateRegionsData();
  if (!validation.valid) {
    console.warn('[REGION] ⚠️ Regions data validation failed, falling back to static config');
    console.warn(`[REGION] 🚨 Error: ${validation.error}`);
    return baseConfig;
  }

  // 选择随机地区
  const selectedRegion = selectRandomRegion();
  if (!selectedRegion) {
    console.warn('[REGION] ⚠️ No region selected, falling back to static config');
    return baseConfig;
  }

  // 构建动态认证信息
  const dynamicAuth = buildDynamicProxyAuth(
    baseConfig.PROXY_USERNAME,
    baseConfig.PROXY_PASSWORD,
    selectedRegion
  );

  // 返回包含动态认证的配置
  return {
    PROXY_IP: baseConfig.PROXY_IP,
    PROXY_PORT: baseConfig.PROXY_PORT,
    PROXY_USERNAME: dynamicAuth.username,
    PROXY_PASSWORD: dynamicAuth.password,
    SELECTED_REGION: selectedRegion
  };
}

// 【代理配置】IP代理配置方案 - 分离式认证
function createProxyAgent() {
  const { PROXY_IP, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD } = getProxyConfig();

  // 【分离式代理配置】采用curl官方方式：分离代理地址和认证信息
  // 构建代理URL - 仅包含地址信息，不含认证
  const PROXY_URL = `http://${PROXY_IP}:${PROXY_PORT}`;

  // 构建认证头 - 独立的认证信息
  const PROXY_AUTH = `Basic ${Buffer.from(`${PROXY_USERNAME}:${PROXY_PASSWORD}`).toString('base64')}`;

  console.log('[PROXY] ✅ 初始化IP代理配置 (分离式认证)');
  console.log(`[PROXY] 🌐 代理服务器: ${PROXY_IP}:${PROXY_PORT}`);
  console.log(`[PROXY] 👤 用户名: ${PROXY_USERNAME}`);
  console.log('[PROXY] 🔒 使用优化SSL配置适配IP代理');
  console.log('[PROXY] 🔐 采用分离式认证方式 (curl官方标准)');

  // 【分离式IP代理配置】地址和认证信息分离，符合curl -x 和 -U 的标准
  return new HttpsProxyAgent(PROXY_URL, {
    headers: {
      'Proxy-Authorization': PROXY_AUTH  // 独立的认证头，等同于curl -U参数
    },
    rejectUnauthorized: false,  // 保持SSL兼容模式
    timeout: 30000             // 30秒连接超时
  });
}

// 【动态代理配置】支持动态地区切换的代理Agent创建
function createDynamicProxyAgent() {
  const config = getDynamicProxyConfig();
  const { PROXY_IP, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD, SELECTED_REGION } = config;

  // 【分离式代理配置】采用curl官方方式：分离代理地址和认证信息
  // 构建代理URL - 仅包含地址信息，不含认证
  const PROXY_URL = `http://${PROXY_IP}:${PROXY_PORT}`;

  // 构建认证头 - 独立的认证信息
  const PROXY_AUTH = `Basic ${Buffer.from(`${PROXY_USERNAME}:${PROXY_PASSWORD}`).toString('base64')}`;

  // 【动态地区日志】
  if (SELECTED_REGION) {
    console.log('[REGION] ✅ 初始化动态地区代理配置');
    console.log(`[REGION] 🌐 选中地区: ${SELECTED_REGION.countryCode}_${SELECTED_REGION.regionCode}_city_${SELECTED_REGION.cityCode}`);
    console.log(`[REGION] 🔐 动态认证: ${PROXY_USERNAME}:${PROXY_PASSWORD.substring(0, 8)}...`);
  } else {
    console.log('[REGION] ✅ 初始化静态地区代理配置 (global模式)');
    console.log(`[REGION] 🌐 使用全局地区: global`);
    console.log(`[REGION] 🔐 静态认证: ${PROXY_USERNAME}:${PROXY_PASSWORD.substring(0, 8)}...`);
  }

  console.log(`[PROXY] 🌐 代理服务器: ${PROXY_IP}:${PROXY_PORT}`);
  console.log(`[PROXY] 👤 用户名: ${PROXY_USERNAME}`);
  console.log('[PROXY] 🔒 使用优化SSL配置适配IP代理');
  console.log('[PROXY] 🔐 采用分离式认证方式 (curl官方标准)');

  // 【分离式IP代理配置】地址和认证信息分离，符合curl -x 和 -U 的标准
  return new HttpsProxyAgent(PROXY_URL, {
    headers: {
      'Proxy-Authorization': PROXY_AUTH  // 独立的认证头，等同于curl -U参数
    },
    rejectUnauthorized: false,  // 保持SSL兼容模式
    timeout: 30000             // 30秒连接超时
  });
}

// 【代理实例】延迟创建，避免模块加载时的配置检查
let httpsAgent = null;

function getProxyAgent() {
  if (!httpsAgent) {
    httpsAgent = createProxyAgent();
    // 【重要说明】关于分离式代理配置的说明
    const { PROXY_IP, PROXY_PORT } = getProxyConfig();
    console.log('[PROXY] 📋 IP代理配置说明 (分离式认证):');
    console.log('[PROXY] 🌐 使用动态IP代理服务');
    console.log('[PROXY] ⚖️ 已启用SSL兼容模式解决证书链问题');
    console.log('[PROXY] 🛡️ 代理连接已加密，数据传输安全');
    console.log('[PROXY] 🎯 配置已优化，应该能够正常返回音频数据');
    console.log(`[PROXY] 📡 当前代理地址: ${PROXY_IP}:${PROXY_PORT}`);
    console.log('[PROXY] 🔐 认证方式: 分离式 Proxy-Authorization 头 (等同于curl -x和-U)');
  }
  return httpsAgent;
}

// 【动态代理Agent获取器】每次调用都创建新的代理实例以支持动态地区切换
function getDynamicProxyAgent() {
  // 检查是否启用动态地区功能
  const enableDynamicRegions = process.env.ENABLE_DYNAMIC_REGIONS === 'true';

  if (enableDynamicRegions) {
    // 动态模式：每次都创建新的代理实例
    console.log('[REGION] 🎲 Creating dynamic proxy agent with random region');
    return createDynamicProxyAgent();
  } else {
    // 静态模式：使用缓存的代理实例
    console.log('[PROXY] 📋 Using static proxy agent (dynamic regions disabled)');
    return getProxyAgent();
  }
}

// 【增强安全】代理密钥验证函数
export function checkProxySecret(req) {
  const incomingSecret = req.headers['x-proxy-secret'];

  // 【安全检查1】环境变量必须存在
  if (!process.env.PROXY_SECRET) {
    console.error('[SECURITY] PROXY_SECRET environment variable is not set!');
    return {
      isValid: false,
      error: { error: 'Server configuration error: Missing proxy secret' }
    };
  }

  // 【安全检查2】请求头必须存在
  if (!incomingSecret) {
    console.warn('[SECURITY] Request missing x-proxy-secret header');
    return {
      isValid: false,
      error: { error: 'Unauthorized: Missing proxy secret header' }
    };
  }

  // 【安全检查3】密钥长度检查（防止空字符串）
  if (incomingSecret.length < 8) {
    console.warn('[SECURITY] Proxy secret too short');
    return {
      isValid: false,
      error: { error: 'Unauthorized: Invalid proxy secret format' }
    };
  }

  // 调试日志（仅开发环境）
  if (process.env.NODE_ENV === 'development') {
    console.log('--- SECRET DEBUG ---');
    console.log(`Expected Secret (from env): >${process.env.PROXY_SECRET}<`);
    console.log(`Received Secret (from header): >${incomingSecret}<`);
    console.log('Are they identical?:', process.env.PROXY_SECRET === incomingSecret);
    console.log('--- END DEBUG ---');
  }

  // 【安全检查4】密钥比较（使用严格相等）
  if (incomingSecret !== process.env.PROXY_SECRET) {
    console.warn('[SECURITY] Invalid proxy secret provided');
    return {
      isValid: false,
      error: { error: 'Unauthorized: Invalid proxy secret' }
    };
  }

  // 【安全日志】记录成功的认证（生产环境）
  if (process.env.NODE_ENV === 'production') {
    console.log('[SECURITY] ✅ Proxy secret validation successful');
  }

  return { isValid: true };
}

// 【防御式编程】状态感知的CORS头部设置
export function safeSetCorsHeaders(res) {
  if (!res.headersSent) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-proxy-secret');
    return true;
  } else {
    console.warn('[CORS] Cannot set headers - response headers already sent');
    return false;
  }
}

// 【向后兼容】保持原有的setCorsHeaders函数
export function setCorsHeaders(res) {
  return safeSetCorsHeaders(res);
}

// 【防御式编程】安全的错误响应发送
export function safeSendError(res, status, errorData) {
  if (!res.headersSent) {
    safeSetCorsHeaders(res);
    res.status(status).json(errorData);
    return true;
  } else {
    // 如果headers已发送，只能记录错误，无法响应客户端
    console.error('[ERROR] Cannot send error response - headers already sent:', {
      status,
      error: errorData,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

// 【向后兼容】保持原有的sendError函数，但使用安全版本
export function sendError(res, status, errorData) {
  return safeSendError(res, status, errorData);
}

// 【防御式编程】安全的成功响应发送
export function safeSendSuccess(res, data) {
  if (!res.headersSent) {
    safeSetCorsHeaders(res);
    res.json(data);
    return true;
  } else {
    console.error('[ERROR] Cannot send success response - headers already sent:', {
      data,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

// 【向后兼容】保持原有的sendSuccess函数，但使用安全版本
export function sendSuccess(res, data) {
  return safeSendSuccess(res, data);
}

// 【防御式编程】安全的OPTIONS请求处理
export function handleOptions(res) {
  if (!res.headersSent) {
    safeSetCorsHeaders(res);
    res.status(200).end();
    return true;
  } else {
    console.error('[ERROR] Cannot handle OPTIONS - headers already sent');
    return false;
  }
}

// 【健壮流管理】流状态跟踪和恢复
export async function robustStreamResponse(elevenLabsResponse, res) {
  const streamState = {
    started: false,
    finished: false,
    errored: false,
    aborted: false,
    startTime: Date.now()
  };

  let streamTimeout = null;

  try {
    // 1. 预检查：确保响应对象处于正确状态
    if (res.headersSent) {
      throw new Error('Response headers already sent - cannot start stream');
    }

    // 2. 设置响应头（只在安全时设置）
    if (!safeSetCorsHeaders(res)) {
      throw new Error('Failed to set CORS headers');
    }

    res.setHeader('Content-Type', elevenLabsResponse.headers.get('Content-Type') || 'audio/mpeg');

    const contentLength = elevenLabsResponse.headers.get('Content-Length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    console.log('[STREAM] Starting robust stream processing...');

    // 3. 创建受控的流管道
    return new Promise((resolve, reject) => {
      // 设置超时保护（30秒）
      streamTimeout = setTimeout(() => {
        if (!streamState.finished && !streamState.errored) {
          streamState.aborted = true;
          console.error('[STREAM] ⏰ Stream timeout after 30 seconds');
          elevenLabsResponse.body.destroy();
          reject(new Error('Stream timeout'));
        }
      }, 30000);

      // 监听源流事件
      elevenLabsResponse.body.on('data', () => {
        if (!streamState.started) {
          streamState.started = true;
          console.log('[STREAM] 📡 Data flow started');
        }
      });

      elevenLabsResponse.body.on('end', () => {
        if (streamTimeout) clearTimeout(streamTimeout);
        if (!streamState.errored && !streamState.aborted) {
          streamState.finished = true;
          const duration = Date.now() - streamState.startTime;
          console.log(`[STREAM] ✅ Stream completed successfully in ${duration}ms`);
          resolve(true);
        }
      });

      elevenLabsResponse.body.on('error', (error) => {
        if (streamTimeout) clearTimeout(streamTimeout);
        streamState.errored = true;
        console.error('[STREAM] ❌ Source stream error:', error);

        // 关键：不要尝试发送错误响应，因为流可能已经开始
        if (streamState.started) {
          console.error('[STREAM] Cannot send error response - stream already started');
          // 只能强制关闭连接
          if (!res.destroyed) {
            res.destroy();
          }
        }
        reject(error);
      });

      // 监听目标响应流事件
      res.on('error', (error) => {
        if (streamTimeout) clearTimeout(streamTimeout);
        streamState.errored = true;
        console.error('[STREAM] ❌ Response stream error:', error);
        if (!elevenLabsResponse.body.destroyed) {
          elevenLabsResponse.body.destroy();
        }
        reject(error);
      });

      res.on('close', () => {
        if (streamTimeout) clearTimeout(streamTimeout);
        if (!streamState.finished) {
          console.log('[STREAM] 🔌 Client disconnected');
          if (!elevenLabsResponse.body.destroyed) {
            elevenLabsResponse.body.destroy();
          }
        }
      });

      // 开始流传输
      try {
        elevenLabsResponse.body.pipe(res);
      } catch (pipeError) {
        if (streamTimeout) clearTimeout(streamTimeout);
        streamState.errored = true;
        console.error('[STREAM] ❌ Pipe error:', pipeError);
        reject(pipeError);
      }
    });

  } catch (error) {
    if (streamTimeout) clearTimeout(streamTimeout);
    console.error('[STREAM] Setup error:', error);

    // 只有在流还没开始时才能发送错误响应
    if (!streamState.started && !res.headersSent) {
      safeSendError(res, 500, { error: 'Stream setup failed', details: error.message });
    }
    return false;
  }
}

// 【向后兼容】保持原有的handleStreamResponse函数
export async function handleStreamResponse(elevenLabsResponse, res) {
  return await robustStreamResponse(elevenLabsResponse, res);
}

// 【故障转移辅助函数】单次API调用尝试
async function attemptElevenLabsAPICall(voiceId, requestBody, timeout, sessionId, browserProfile, retryCount = 0) {
  const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?allow_unauthenticated=1`;

  // 【代理日志】详细记录分离式代理使用情况
  try {
    const { PROXY_IP, PROXY_PORT, PROXY_USERNAME } = getDynamicProxyConfig();
    const PROXY_URL = `http://${PROXY_IP}:${PROXY_PORT}`;
    console.log(`[PROXY] 🌐 Attempt ${retryCount + 1}: Using IP proxy ${PROXY_IP}:${PROXY_PORT} for ElevenLabs API`);
    console.log(`[PROXY] 📡 Proxy URL: ${PROXY_URL}`);
    console.log(`[PROXY] 🔐 Auth Method: Proxy-Authorization header (用户名: ${PROXY_USERNAME})`);
  } catch (error) {
    console.log(`[PROXY] 🌐 Attempt ${retryCount + 1}: Using proxy for ElevenLabs API (configuration pending)`);
  }
  console.log(`[PROXY] 🎯 Target URL: ${elevenLabsUrl}`);
  console.log(`[PROXY] ⏱️  Timeout: ${timeout}ms`);
  console.log(`[FINGERPRINT] 🎭 Using browser profile: ${browserProfile.name}`);
  console.log(`[FINGERPRINT] 🔑 Session ID: ${sessionId}`);

  const startTime = Date.now();

  // 【指纹模拟】构建完整的浏览器头部
  const headers = {
    'Content-Type': 'application/json',
    ...browserProfile.headers  // 合并浏览器画像的所有头部
  };

  const elevenLabsResponse = await fetch(elevenLabsUrl, {
    method: 'POST',
    headers: headers,
    body: requestBody,
    timeout: timeout,
    agent: getDynamicProxyAgent()  // 【使用动态HTTPS代理】支持动态地区切换
  });

  const responseTime = Date.now() - startTime;

  // 【会话统计】更新请求计数
  if (activeSessions.has(sessionId)) {
    activeSessions.get(sessionId).requestCount++;
  }

  // 【代理日志】成功响应日志
  console.log(`[PROXY] ✅ Proxy request successful!`);
  console.log(`[PROXY] 📊 Response status: ${elevenLabsResponse.status}`);
  console.log(`[PROXY] ⚡ Response time: ${responseTime}ms`);
  console.log(`[PROXY] 🔗 Content-Type: ${elevenLabsResponse.headers.get('Content-Type')}`);
  console.log(`[FINGERPRINT] 📈 Session ${sessionId} request count: ${activeSessions.get(sessionId)?.requestCount || 0}`);

  // 【HTTP错误处理】检查状态码并决定是否触发重试
  if (!elevenLabsResponse.ok) {
    console.warn(`[PROXY] ⚠️ Non-2xx status code received: ${elevenLabsResponse.status}`);
    console.warn(`[PROXY] 📋 Response headers:`, Object.fromEntries(elevenLabsResponse.headers.entries()));
    console.warn(`[FINGERPRINT] 🚨 Failed request with profile: ${browserProfile.name}`);

    // 解析错误响应体以获取详细信息
    let errorBody = {};
    try {
      errorBody = await elevenLabsResponse.json();
      console.warn(`[PROXY] 📄 Error response body:`, JSON.stringify(errorBody, null, 2));
    } catch (parseError) {
      try {
        const errorText = await elevenLabsResponse.text();
        console.warn(`[PROXY] 📄 Error response text:`, errorText);
        errorBody = { error: 'Non-JSON response', details: errorText };
      } catch (textError) {
        console.warn(`[PROXY] 🚨 Failed to parse error response:`, textError.message);
        errorBody = { error: 'Failed to parse error response', status: elevenLabsResponse.status };
      }
    }

    // 抛出特殊异常以触发重试机制
    // 格式: HTTP_ERROR_[状态码]: [错误详情]
    const errorMessage = `HTTP_ERROR_${elevenLabsResponse.status}: ${JSON.stringify(errorBody)}`;
    console.warn(`[PROXY] 🔄 Throwing retryable HTTP error: ${errorMessage.substring(0, 200)}...`);
    throw new Error(errorMessage);
  }

  return elevenLabsResponse;
}

// ElevenLabs API 调用 - 通过代理服务器（集成浏览器指纹模拟和故障转移）
export async function callElevenLabsAPI(voiceId, requestBody, timeout = 180000) {
  // 【指纹模拟】生成会话ID并获取浏览器画像
  const sessionId = generateSessionId(voiceId, requestBody);
  const browserProfile = getBrowserProfileForSession(sessionId);

  // 【行为模拟】添加随机延迟（模拟人类行为）
  const delay = getRandomDelay();
  console.log(`[FINGERPRINT] ⏱️ Adding human-like delay: ${delay}ms`);
  await new Promise(resolve => setTimeout(resolve, delay));

  // 【故障转移配置】
  const enableDynamicRegions = process.env.ENABLE_DYNAMIC_REGIONS === 'true';
  const maxRetries = enableDynamicRegions ? 3 : 1; // 动态模式允许重试，静态模式不重试
  let lastError = null;

  // 【HTTP错误重试辅助函数】根据错误类型确定最大重试次数
  function getMaxRetriesForHttpError(error) {
    if (error.message.includes('HTTP_ERROR_429') ||
        error.message.includes('HTTP_ERROR_401') ||
        error.message.includes('HTTP_ERROR_403')) {
      return 2; // 429/401/403最大重试2次
    } else if (error.message.startsWith('HTTP_ERROR_')) {
      return 1; // 其他HTTP错误最大重试1次
    }
    return maxRetries; // 网络错误使用原有配置
  }

  // 【HTTP错误重试延迟函数】根据错误类型确定延迟时间
  function getRetryDelay(error, retryCount) {
    if (error.message.startsWith('HTTP_ERROR_')) {
      // HTTP错误使用短延迟（1-3秒随机）
      const delay = 1000 + Math.random() * 2000;
      console.log(`[REGION] ⏱️ HTTP error retry delay: ${Math.round(delay)}ms (1-3s random)`);
      return delay;
    } else {
      // 网络错误使用原有递增延迟（1s, 1.5s, 2s）
      const delay = 1000 + (retryCount * 500);
      console.log(`[REGION] ⏱️ Network error retry delay: ${delay}ms`);
      return delay;
    }
  }

  console.log(`[REGION] 🔄 Starting API call with ${enableDynamicRegions ? 'dynamic regions' : 'static proxy'} (max retries: ${maxRetries})`);

  // 【故障转移循环】尝试多次调用，每次使用不同的地区
  for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
    try {
      console.log(`[REGION] 🎯 Attempt ${retryCount + 1}/${maxRetries}`);

      // 如果是重试，添加额外延迟
      if (retryCount > 0) {
        // 使用动态延迟策略（根据上次错误类型决定）
        const retryDelay = lastError ? getRetryDelay(lastError, retryCount) : 1000 + (retryCount * 500);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      // 尝试API调用
      const result = await attemptElevenLabsAPICall(voiceId, requestBody, timeout, sessionId, browserProfile, retryCount);

      // 成功则返回结果
      if (retryCount > 0) {
        console.log(`[REGION] ✅ API call succeeded on retry ${retryCount + 1}`);
      }
      return result;

    } catch (error) {
      lastError = error;

      // 【错误分析】判断是否值得重试
      const isRetryableError = (
        // 网络层错误（保持原有逻辑）
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('timeout') ||
        error.message.includes('ETIMEDOUT') ||
        // HTTP错误响应（新增重试支持）
        error.message.includes('HTTP_ERROR_429') ||  // 429错误（包括quota_exceeded）
        error.message.includes('HTTP_ERROR_401') ||  // 401认证错误
        error.message.includes('HTTP_ERROR_403') ||  // 403权限错误
        error.message.startsWith('HTTP_ERROR_')      // 其他所有HTTP错误
      );

      console.error(`[REGION] ❌ Attempt ${retryCount + 1} failed for voice ${voiceId}`);

      // ---------> START: 添加详细日志 <---------
      console.error(`[REGION]    Error Name: ${error.name || 'Unknown'}`);
      console.error(`[REGION]    Error Message: ${error.message || 'No message'}`);

      // 【HTTP错误特殊处理】解析HTTP错误详情
      if (error.message.startsWith('HTTP_ERROR_')) {
        const statusMatch = error.message.match(/HTTP_ERROR_(\d+):/);
        if (statusMatch) {
          const statusCode = statusMatch[1];
          console.error(`[REGION]    HTTP Status Code: ${statusCode}`);

          // 根据状态码提供更多上下文信息
          if (statusCode === '429') {
            console.error(`[REGION]    HTTP Error Type: Rate Limiting (429)`);
            console.error(`[REGION]    Retry Strategy: Short delay (1-3s), max 2 retries`);
          } else if (statusCode === '401') {
            console.error(`[REGION]    HTTP Error Type: Unauthorized (401)`);
            console.error(`[REGION]    Retry Strategy: Short delay (1-3s), max 2 retries`);
          } else if (statusCode === '403') {
            console.error(`[REGION]    HTTP Error Type: Forbidden (403)`);
            console.error(`[REGION]    Retry Strategy: Short delay (1-3s), max 2 retries`);
          } else {
            console.error(`[REGION]    HTTP Error Type: Other HTTP Error (${statusCode})`);
            console.error(`[REGION]    Retry Strategy: Short delay (1-3s), max 1 retry`);
          }
        }
      }

      // 如果错误有关联的响应，打印状态码和响应体
      if (error.response) {
        console.error(`[REGION]    Upstream Status: ${error.response.status}`);
        console.error(`[REGION]    Upstream Status Text: ${error.response.statusText || 'N/A'}`);

        // 尝试打印上游的错误响应体
        try {
          const errBody = await error.response.text();
          console.error(`[REGION]    Upstream Body: ${errBody.substring(0, 500)}`);
        } catch (bodyError) {
          console.error(`[REGION]    Upstream Body: Failed to read response body - ${bodyError.message}`);
        }
      } else if (error.code) {
        // 网络错误通常有 code 属性
        console.error(`[REGION]    Error Code: ${error.code}`);
      }

      // 打印堆栈跟踪（截取前1000字符避免日志过长）
      if (error.stack) {
        console.error(`[REGION]    Stack Trace: ${error.stack.substring(0, 1000)}`);
      }
      // ---------> END: 添加详细日志 <---------

      // 【动态重试次数】根据错误类型确定实际的最大重试次数
      const actualMaxRetries = error.message.startsWith('HTTP_ERROR_') ?
        getMaxRetriesForHttpError(error) : maxRetries;

      if (!enableDynamicRegions || !isRetryableError || retryCount === actualMaxRetries - 1) {
        // 不重试的情况：
        // 1. 未启用动态地区功能
        // 2. 错误不可重试
        // 3. 已达到最大重试次数
        const reason = !enableDynamicRegions ? 'Dynamic regions disabled' :
                      !isRetryableError ? 'Non-retryable error' :
                      `Max retries reached (${actualMaxRetries})`;
        console.error(`[REGION] 🚫 No more retries. Reason: ${reason}`);
        break;
      }

      // 显示剩余重试次数（使用动态重试次数）
      const retriesLeft = actualMaxRetries - retryCount - 1;

      if (error.message.startsWith('HTTP_ERROR_')) {
        console.log(`[REGION] 🔄 Will retry HTTP error (${retriesLeft} retries left)`);
      } else {
        console.log(`[REGION] 🔄 Will retry with different region (${retriesLeft} retries left)`);
      }
    }
  }

  // 【最终错误处理】所有重试都失败了
  console.error(`[REGION] 💥 All attempts failed. Last error: ${lastError?.message}`);

  // 添加详细的错误信息
  if (lastError) {
    // 判断是否是代理相关错误
    if (lastError.message.includes('ECONNREFUSED') || lastError.message.includes('ENOTFOUND')) {
      try {
        const { PROXY_IP, PROXY_PORT } = getDynamicProxyConfig();
        console.error(`[PROXY] 🔌 Possible proxy connection issue - check ${PROXY_IP}:${PROXY_PORT}`);
      } catch {
        console.error(`[PROXY] 🔌 Possible proxy connection issue - check proxy configuration`);
      }
    } else if (lastError.message.includes('timeout')) {
      console.error(`[PROXY] ⏰ Request timeout through proxy (${timeout}ms)`);
    } else if (lastError.message.includes('429') || lastError.message.includes('Too Many Requests')) {
      console.error(`[FINGERPRINT] 🚫 Rate limited - profile may be detected: ${browserProfile.name}`);
      // 对于429错误，可以考虑立即切换画像
      activeSessions.delete(sessionId);
      console.log(`[FINGERPRINT] 🔄 Cleared session ${sessionId} due to rate limiting`);
    }
  }

  throw lastError; // 重新抛出最后一个错误
}
