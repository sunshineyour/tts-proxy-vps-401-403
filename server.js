// server.js - Ubuntu服务器版本的Express应用入口

// 【环境变量】加载.env文件配置
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import healthHandler from './api/health.js';
import ttsHandler from './api/v1/text-to-speech/tts.js';

// 创建 Express 应用
const app = express();
const PORT = process.env.PORT || 3007;

// 中间件：让 Express 能够自动解析 JSON 请求体
// 这替代了 Vercel 的自动解析功能
app.use(express.json());

// 中间件：解析原始请求体（用于处理音频数据）
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

console.log('🚀 Ubuntu TTS Proxy Server starting...');

// 1. 设置路由：将 Vercel 的文件路由手动映射过来

// 健康检查路由 - 保持与Vercel版本一致的路径
app.all('/api/health', healthHandler);

// TTS 代理路由 - 匹配实际的API结构 /api/v1/text-to-speech/:voice_id
app.all('/api/v1/text-to-speech/:voice_id', ttsHandler);

// 2. 根路径欢迎信息
app.get('/', (req, res) => {
  res.json({
    message: 'ElevenLabs TTS Proxy is running on Ubuntu Server!',
    version: '2.0.0',
    platform: 'ubuntu-express',
    features: {
      realTimeStreaming: true,
      rateLimitRemoved: true,
      memoryOptimized: true
    },
    endpoints: {
      health: '/api/health',
      tts: '/api/v1/text-to-speech/:voice_id'
    }
  });
});

// 3. 404 处理
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /',
      'GET /api/health',
      'POST /api/v1/text-to-speech/:voice_id'
    ]
  });
});

// 4. 全局错误处理中间件
app.use((error, req, res, next) => {
  console.error('[SERVER] Unhandled error:', error);
  
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 5. 启动服务器
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // 安全检查
  if (!process.env.PROXY_SECRET) {
    console.warn('⚠️ [SECURITY WARNING] PROXY_SECRET environment variable is not set!');
    console.warn('⚠️ The server is running in INSECURE mode!');
  } else {
    console.log('🔒 Security: PROXY_SECRET is configured');
  }
  
  console.log('🎯 Available endpoints:');
  console.log('   GET  /                              - Server info');
  console.log('   GET  /api/health                    - Health check');
  console.log('   POST /api/v1/text-to-speech/:voice_id - TTS proxy');
});

// 优雅关闭处理
process.on('SIGTERM', () => {
  console.log('📴 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

export default app;
