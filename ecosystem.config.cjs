// PM2配置文件 - 使用CommonJS格式(.cjs)以兼容PM2
module.exports = {
  apps: [{
    name: 'ubuntu-tts-proxy-workers4',
    script: 'server.js',
    instances: 1, // 单实例模式，避免速率限制共享问题
    exec_mode: 'fork', // 使用fork模式而不是cluster模式
    autorestart: true,
    watch: false, // 生产环境不监听文件变化
    max_memory_restart: '1G', // 内存超过1G时重启
    env: {
      NODE_ENV: 'production',
      PORT: 3007,
      PROXY_SECRET: 'AKIDFORI0ZwAFKMH1c6VjkbFk183pSs66xd9'
      // 【代理配置】从.env文件读取，保持配置灵活性和安全性
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3007,
      PROXY_SECRET: 'dev_secret_for_testing'
      // 【代理配置】从.env文件读取，便于开发调试
    },
    // 日志配置
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // 进程管理配置
    min_uptime: '10s', // 最小运行时间
    max_restarts: 10, // 最大重启次数
    restart_delay: 4000, // 重启延迟
    
    // 监控配置
    monitoring: false, // 如果使用PM2 Plus，设置为true
  }],

  // 部署配置（可选）
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-server-ip',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/ubuntu-tts-proxy.git',
      path: '/var/www/ubuntu-tts-proxy',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': ''
    }
  }
};
