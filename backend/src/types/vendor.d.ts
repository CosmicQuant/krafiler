declare module 'puppeteer-extra-plugin-stealth' {
    const plugin: any;
    export default plugin;
}

declare module '@google-cloud/pubsub' {
    export class PubSub {
        constructor(options?: any);
        topic(name: string): any;
        createTopic(name: string): Promise<any>;
    }
}
