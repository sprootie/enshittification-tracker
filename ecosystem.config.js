module.exports = {
  apps: [{
    name: 'enshittindex',
    script: 'server.js',
    node_args: '--expose-gc --max-old-space-size=384',
    max_memory_restart: '750M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      CHROMIUM_PATH: '/usr/bin/chromium-browser',
      DB_PATH: '/opt/enshittifier/data/enshittindex.db',
    },
  }],
};
