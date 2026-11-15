/**
 * PM2 — uma única instância (fork). NÃO use cluster/instances > 1:
 * a sessão do WhatsApp só pode estar aberta em um processo (há um lock para impedir).
 */
module.exports = {
  apps: [
    {
      name: 'chupalink-api',
      script: 'dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 10000, // tempo para fechar o socket e liberar o lock
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production', APP_ENV: 'production' },
      out_file: './storage/logs/pm2-out.log',
      error_file: './storage/logs/pm2-error.log',
      time: true,
    },
  ],
};
