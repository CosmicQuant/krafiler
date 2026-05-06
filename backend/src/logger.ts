import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logsDir = path.resolve(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        targets: [
            {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
            },
            {
                target: 'pino-roll',
                options: {
                    file: path.join(logsDir, 'server.log'),
                    frequency: 'daily',
                    mkdir: true,
                    size: '10m', // Rotate when file size reaches 10MB
                    limit: { count: 14 }, // Keep logs for 14 days
                },
            },
        ],
    },
});
