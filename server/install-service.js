const Service = require('node-windows').Service;

const svc = new Service({
  name: 'WolffieService',
  description: 'Automatically starts my Node.js app',
  script: 'C:\\website\\_wolffie\\server\\server.js' // MUST be an absolute path
});

svc.on('install', function() {
  svc.start();
});

svc.install();