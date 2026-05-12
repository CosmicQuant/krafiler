const Redis = require('ioredis');
const redis = new Redis();

async function main() {
    try {
        const keys = await redis.keys('bull:kra-filing-queue:*');
        for (const key of keys) {
            const type = await redis.type(key);
            if (type === 'hash') {
                const data = await redis.hget(key, 'data');
                if (data) {
                    const parsed = JSON.parse(data);
                    if (parsed.nssfUsername && parsed.nssfPassword) {
                        console.log(parsed.nssfUsername, parsed.nssfPassword);
                        process.exit(0);
                    }
                    if (parsed.credentials && parsed.credentials.username) {
                        console.log(parsed.credentials.username, parsed.credentials.password);
                        process.exit(0);
                    }
                }
            }
        }
    } catch(e) {}
    console.log("NO_CREDS");
    process.exit(1);
}
main();