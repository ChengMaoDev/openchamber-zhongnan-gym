import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function verifyWorker(runtime: string, path: string): Promise<void> {
  const script = `
    const {Worker}=require('node:worker_threads');
    const worker=new Worker(process.argv[1]);
    const current=Date.parse('2026-11-13T12:00:00+08:00')/1000;
    const start=current-43200;
    const samples=[];
    for(let minute=420;minute<1380;minute+=5)
      samples.push({timestamp:start-86400+minute*60,count:20});
    const predict=samples=>new Promise((resolve,reject)=>{
      worker.once('error',reject);worker.once('message',resolve);
      worker.postMessage({samples,current});
    });
    (async()=>{
      try{
        const first=await predict(samples);
        const imported=[];
        for(let minute=420;minute<1380;minute+=5)
          imported.push({timestamp:start-2*86400+minute*60,count:120});
        const second=await predict([...imported,...samples]);
        if(!first.prediction||!second.prediction||second.prediction.trainingDays!==2)
          throw new Error('历史导入后的模型没有完成训练');
        if(!(second.prediction.points[0]?.count>first.prediction.points[0]?.count+20))
          throw new Error('训练天数更新但曲线仍沿用旧模型');
      } finally { await worker.terminate(); }
    })().catch(error=>{console.error(error);process.exitCode=1});
  `;
  await promisify(execFile)(runtime, ["--input-type=commonjs", "-e", script, path], {
    timeout: 15000,
    env: process.env,
  });
}
