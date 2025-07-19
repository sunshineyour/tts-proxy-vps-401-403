import {
  checkProxySecret,
  handleOptions,
  safeSendError,
  robustStreamResponse,
  callElevenLabsAPI,
  concurrencyManager,
  elevenLabsCircuitBreaker
} from '../../../lib/utils.js';

// 【健壮TTS处理器】集成所有最佳实践组件
export default async function robustTtsHandler(req, res) {
  const requestId = concurrencyManager.generateRequestId();
  let voiceId = null;

  try {
    // 1. 基础验证
    if (req.method === 'OPTIONS') {
      return handleOptions(res);
    }

    if (req.method !== 'POST') {
      return safeSendError(res, 405, { error: 'Method not allowed' });
    }

    voiceId = req.params.voice_id;
    if (!voiceId) {
      return safeSendError(res, 400, { error: 'Voice ID is required' });
    }

    console.log(`[TTS] ${requestId} Processing request for voice_id: ${voiceId}`);

    // 2. 安全验证
    const authResult = checkProxySecret(req);
    if (!authResult.isValid) {
      return safeSendError(res, 401, authResult.error);
    }

    // 3. 并发控制检查
    if (!concurrencyManager.canProcessRequest(voiceId)) {
      return safeSendError(res, 429, {
        error: 'Too many concurrent requests for this voice',
        details: `Maximum ${concurrencyManager.maxConcurrentPerVoice} concurrent requests allowed per voice`,
        retryAfter: 5,
        requestId
      });
    }

    // 4. 电路熔断器状态检查
    if (!elevenLabsCircuitBreaker.isHealthy()) {
      const stats = elevenLabsCircuitBreaker.getStats();
      return safeSendError(res, 503, {
        error: 'Service temporarily unavailable',
        details: 'Circuit breaker is open due to repeated failures',
        retryAfter: Math.ceil(stats.configuration.resetTimeout / 1000),
        circuitState: stats.state,
        requestId
      });
    }

    // 5. 注册并发请求
    concurrencyManager.startRequest(voiceId, requestId);

    // 6. 请求体处理
    let requestBody;
    try {
      if (req.body) {
        // Express 已经解析了请求体
        if (typeof req.body === 'string') {
          requestBody = req.body;
        } else {
          requestBody = JSON.stringify(req.body);
        }
      } else {
        // 手动读取请求体（备用方案）
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        requestBody = Buffer.concat(chunks).toString();
      }

      if (!requestBody || requestBody.trim().length === 0) {
        throw new Error('Request body is empty');
      }

      console.log(`[TTS] ${requestId} Request body prepared, calling ElevenLabs API...`);
    } catch (bodyError) {
      console.error(`[TTS] ${requestId} Request body processing error:`, bodyError);
      return safeSendError(res, 400, {
        error: 'Invalid request body',
        details: bodyError.message,
        requestId
      });
    }

    // 7. 电路熔断保护的API调用
    const elevenLabsResponse = await elevenLabsCircuitBreaker.execute(async () => {
      return await callElevenLabsAPI(
        voiceId,
        requestBody,
        parseInt(process.env.STREAM_TIMEOUT) || 180000
      );
    });

    // 8. 响应处理
    if (elevenLabsResponse.ok) {
      console.log(`[TTS] ${requestId} ✅ ElevenLabs API call successful, starting stream...`);

      // 成功响应 - 使用健壮的流处理
      const streamSuccess = await robustStreamResponse(elevenLabsResponse, res);

      if (streamSuccess) {
        console.log(`[TTS] ${requestId} ✅ Stream processing completed successfully`);
      } else {
        console.error(`[TTS] ${requestId} ❌ Stream processing failed`);
        // 注意：如果流已经开始，safeSendError可能无法发送响应
        safeSendError(res, 500, {
          error: 'Failed to process audio stream',
          details: 'Stream processing error',
          requestId
        });
      }
    } else {
      // 错误响应 - 转发 ElevenLabs 的错误
      console.error(`[TTS] ${requestId} ❌ ElevenLabs API returned error status: ${elevenLabsResponse.status}`);
      console.error(`[PROXY] 📋 Response headers:`, Object.fromEntries(elevenLabsResponse.headers.entries()));

      let errorBody = {};
      try {
        // 尝试解析JSON错误响应
        errorBody = await elevenLabsResponse.json();
        console.error(`[PROXY] 📄 Error response body:`, JSON.stringify(errorBody, null, 2));
      } catch (parseError) {
        // 如果不是JSON，尝试获取文本内容
        try {
          const errorText = await elevenLabsResponse.text();
          console.error(`[PROXY] 📄 Error response text:`, errorText);
          errorBody = { error: 'Non-JSON response', details: errorText };
        } catch (textError) {
          console.error(`[PROXY] 🚨 Failed to parse error response:`, textError.message);
          errorBody = { error: 'Failed to parse error response', status: elevenLabsResponse.status };
        }
      }

      // 添加请求ID到错误响应
      errorBody.requestId = requestId;
      safeSendError(res, elevenLabsResponse.status, errorBody);
    }

  } catch (error) {
    console.error(`[TTS] ${requestId} ❌ Internal error:`, error);

    // 智能错误分类和处理
    let statusCode = 502;
    let errorResponse = {
      error: 'Bad Gateway',
      details: error.message,
      requestId
    };

    if (error.message.includes('Circuit breaker is OPEN')) {
      statusCode = 503;
      errorResponse = {
        error: 'Service temporarily unavailable',
        details: 'Circuit breaker is open due to repeated failures',
        retryAfter: 30,
        requestId
      };
    } else if (error.name === 'AbortError' || error.message.includes('timeout')) {
      statusCode = 504;
      errorResponse = {
        error: 'Gateway Timeout',
        details: 'Request to ElevenLabs timed out',
        timeout: parseInt(process.env.STREAM_TIMEOUT) || 180000,
        requestId
      };
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      statusCode = 502;
      errorResponse = {
        error: 'Bad Gateway',
        details: 'Unable to connect to ElevenLabs API',
        requestId
      };
    } else if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
      statusCode = 429;
      errorResponse = {
        error: 'Too Many Requests',
        details: 'Rate limited by ElevenLabs API',
        retryAfter: 60,
        requestId
      };
    }

    safeSendError(res, statusCode, errorResponse);
  } finally {
    // 9. 资源清理
    if (voiceId && requestId) {
      concurrencyManager.finishRequest(voiceId, requestId);
    }
  }
}