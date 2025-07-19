import {
  checkProxySecret,
  setCorsHeaders,
  handleOptions,
  sendError,
  sendSuccess,
  safeSendError,
  safeSendSuccess,
  concurrencyManager,
  elevenLabsCircuitBreaker,
  activeSessions,
  BROWSER_PROFILES
} from '../lib/utils.js';

// 【增强健康检查】集成所有监控指标
export default async function enhancedHealthHandler(req, res) {
  try {
    // 处理 CORS 预检请求
    if (req.method === 'OPTIONS') {
      return handleOptions(res);
    }

    // 只允许 GET 请求
    if (req.method !== 'GET') {
      return safeSendError(res, 405, { error: 'Method not allowed' });
    }

    // 【安全验证】检查代理密钥
    const authResult = checkProxySecret(req);
    if (!authResult.isValid) {
      return safeSendError(res, 401, authResult.error);
    }

    // 收集系统健康数据
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    const now = new Date().toISOString();

    // 获取并发管理器状态
    const concurrencyStats = concurrencyManager.getDetailedStatus();

    // 获取电路熔断器状态
    const circuitBreakerStats = elevenLabsCircuitBreaker.getStats();

    // 计算系统健康评分
    const healthScore = calculateHealthScore(concurrencyStats, circuitBreakerStats, memoryUsage);

    // 构建完整的健康报告
    const healthData = {
      status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'degraded' : 'unhealthy',
      healthScore: healthScore,
      message: 'Enhanced TTS Proxy Server with Robust Error Handling',
      timestamp: now,
      uptime: {
        seconds: Math.floor(uptime),
        human: formatUptime(uptime)
      },

      // 系统信息
      system: {
        platform: 'ubuntu-express',
        version: '3.0.0-robust',
        nodeVersion: process.version,
        pid: process.pid
      },

      // 内存使用情况
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        unit: 'MB',
        usage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },

      // 功能特性
      features: {
        robustErrorHandling: true,
        concurrencyControl: true,
        circuitBreaker: true,
        browserFingerprinting: true,
        realTimeStreaming: true,
        memoryOptimized: true
      },

      // 并发控制状态
      concurrency: {
        status: concurrencyStats.statistics.activeRequests > 0 ? 'active' : 'idle',
        enabled: concurrencyStats.configuration.concurrencyEnabled,
        configuration: {
          maxConcurrentPerVoice: concurrencyStats.configuration.maxConcurrentPerVoice,
          concurrencyEnabled: concurrencyStats.configuration.concurrencyEnabled
        },
        statistics: concurrencyStats.statistics,
        activeRequests: concurrencyStats.activeRequests
      },

      // 电路熔断器状态
      circuitBreaker: {
        status: circuitBreakerStats.state,
        isHealthy: elevenLabsCircuitBreaker.isHealthy(),
        configuration: circuitBreakerStats.configuration,
        statistics: circuitBreakerStats.statistics,
        currentFailures: circuitBreakerStats.failures,
        lastFailure: circuitBreakerStats.lastFailureTime
      },

      // 浏览器指纹模拟状态
      fingerprinting: {
        activeSessions: activeSessions.size,
        availableProfiles: BROWSER_PROFILES.length,
        profileNames: BROWSER_PROFILES.map(p => p.name)
      }
    };

    return safeSendSuccess(res, healthData);

  } catch (error) {
    console.error('[HEALTH] Error:', error);
    return safeSendError(res, 500, {
      error: 'Health check failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// 计算系统健康评分（0-100）
function calculateHealthScore(concurrencyStats, circuitStats, memoryUsage) {
  let score = 100;

  // 内存使用评分（30%权重）
  const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
  if (memoryUsagePercent > 90) score -= 30;
  else if (memoryUsagePercent > 80) score -= 20;
  else if (memoryUsagePercent > 70) score -= 10;

  // 电路熔断器状态评分（40%权重）
  if (circuitStats.state === 'OPEN') score -= 40;
  else if (circuitStats.state === 'HALF_OPEN') score -= 20;

  // 并发负载评分（20%权重）
  const activeRequests = concurrencyStats.statistics.activeRequests;
  const maxConcurrent = concurrencyStats.configuration.maxConcurrentPerVoice * 5; // 假设最多5个voice同时使用
  const loadPercent = (activeRequests / maxConcurrent) * 100;
  if (loadPercent > 90) score -= 20;
  else if (loadPercent > 80) score -= 15;
  else if (loadPercent > 70) score -= 10;

  // 错误率评分（10%权重）
  const totalRequests = circuitStats.statistics.totalRequests;
  const totalFailures = circuitStats.statistics.totalFailures;
  if (totalRequests > 0) {
    const errorRate = (totalFailures / totalRequests) * 100;
    if (errorRate > 20) score -= 10;
    else if (errorRate > 10) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

// 格式化运行时间
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
