module.exports = {
  apps: [
    {
      name: 'make-pdf',
      script: 'dist/main.js',
      instances: 1, // Puedes ajustar la cantidad de instancias según tus necesidades
      exec_mode: 'fork', // "cluster" si quieres utilizar múltiples núcleos
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
