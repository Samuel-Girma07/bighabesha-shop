module.exports = {
  apps: [
    {
      name: 'bighabesha-bot',
      script: 'bot/dist/index.js',
      cwd: '/opt/bighabesha-shop',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
};
