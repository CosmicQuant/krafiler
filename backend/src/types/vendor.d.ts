declare module 'puppeteer-extra-plugin-stealth' {
    const plugin: any;
    export default plugin;
}

declare module 'pdf-lib' {
    export class PDFDocument {
        static load(data: Uint8Array): Promise<PDFDocument>;
        static create(): Promise<PDFDocument>;
        static new(): PDFDocument;
        save(): Promise<Uint8Array>;
        getPages(): any[];
        addPage(size?: any): any;
        insertPage(index: number): any;
        removePage(index: number): void;
        copyPages(src: PDFDocument, indices: number[]): Promise<any[]>;
        embedPng(data: any): Promise<any>;
        embedJpg(data: any): Promise<any>;
    }
}

declare module '@google-cloud/pubsub' {
    export class PubSub {
        constructor(options?: any);
        topic(name: string): any;
        createTopic(name: string): Promise<any>;
    }
}

declare module 'cheerio' {
    type CheerioAPI = any;
    const load: (html: string, options?: any) => CheerioAPI;
    export { load, CheerioAPI };
    export default load;
}

declare module 'tesseract.js' {
    export function recognize(image: any, lang?: string, options?: any): Promise<any>;
    export function createWorker(lang?: string): Promise<any>;
}
