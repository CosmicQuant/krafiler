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
                target: 'pino/file',
                options: {
                    destination: path.join(logsDir, 'server.log'),
                    mkdir: true,
                },
            },
        ],
    },
});
