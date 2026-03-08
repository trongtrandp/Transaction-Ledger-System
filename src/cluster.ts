/* eslint-disable @typescript-eslint/no-require-imports */
const cluster = require('node:cluster');
const os = require('node:os');

const numWorkers = parseInt(process.env.CLUSTER_WORKERS ?? '', 10) || os.availableParallelism();

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} starting ${numWorkers} workers`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker: { process: { pid: number } }, code: number, signal: string) => {
    console.warn(`Worker ${worker.process.pid} exited (code=${code}, signal=${signal}). Restarting...`);
    cluster.fork();
  });
} else {
  require('./main');
}
