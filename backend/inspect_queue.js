const { Queue, Job } = require("bullmq");
const IORedis = require("ioredis");
require("dotenv").config();

const connection = new IORedis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
});

async function run() {
  const queueName = "kra-filing-queue";
  const queue = new Queue(queueName, { connection });

  try {
    const states = ["completed", "failed", "active", "waiting", "delayed"];
    let allJobs = [];
    for (const state of states) {
        const jobs = await queue.getJobs([state], 0, 100);
        allJobs = allJobs.concat(jobs);
    }

    allJobs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let latestMatch = null;
    for (const job of allJobs) {
      const data = job.data || {};
      const returnValue = job.returnvalue || {};
      const credUpdate = data.credentialUpdate || returnValue.credentialUpdate;
      if (credUpdate) {
        latestMatch = { job, credUpdate };
        break;
      }
    }

    if (!latestMatch) {
      console.log("No job found with a credential update.");
    } else {
      const { job, credUpdate } = latestMatch;
      const state = await job.getState();
      const logs = await queue.getJobLogs(job.id);
      
      const mentionLogs = (logs.logs || []).filter(line => 
        line.toLowerCase().includes("password") || line.toLowerCase().includes("reset")
      ).join("\n");

      console.log(JSON.stringify({
        jobId: job.id,
        state: state,
        kraPin: job.data.kraPin,
        taxObligationType: job.data.taxObligationType,
        createdAt: new Date(job.timestamp).toISOString(),
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        changedAt: credUpdate.changedAt,
        newPassword: credUpdate.newPassword,
        passwordChanged: credUpdate.passwordChanged === true,
        logs: mentionLogs
      }, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await connection.quit();
  }
}
run();
