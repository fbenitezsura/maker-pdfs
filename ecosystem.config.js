module.exports = {
  apps: [
    {
      name: 'make-pdf',
      script: 'dist/main.js',
      instances: 3, // Puedes ajustar la cantidad de instancias según tus necesidades
      exec_mode: 'cluster', // "cluster" si quieres utilizar múltiples núcleos
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
