import got from 'got';
import { CookieJar } from 'tough-cookie';

async function main() {
    const jar = new CookieJar();
    await got('https://itax.kra.go.ke/KRA-Portal/', {
        cookieJar: jar,
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    let body = 'callCount=1\nwindowName=DWR-TEST\nc0-scriptName=__System\nc0-methodName=pageLoaded\nc0-id=0\nbatchId=0\npage=/KRA-Portal/\nhttpSessionId=\nscriptSessionId=\n';
    let r = await got.post('https://itax.kra.go.ke/KRA-Portal/dwr/call/plaincall/__System.pageLoaded.dwr', {
        cookieJar: jar,
        body,
        headers: {
            'Content-Type': 'text/plain',
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://itax.kra.go.ke/KRA-Portal/',
        },
    });
    const m = r.body.match(/handleNewScriptSession\(['"]([^'"]+)['"]\)/);
    const ssid = m ? m[1] : '';
    console.log('scriptSessionId:', ssid);

    body = 'callCount=1\nwindowName=DWR-TEST\nc0-scriptName=CheckLoginPin\nc0-methodName=checkLoginPin\nc0-id=0\nc0-param0=string:P051699440T\nbatchId=1\npage=/KRA-Portal/\nhttpSessionId=\nscriptSessionId=' + ssid + '\n';
    r = await got.post('https://itax.kra.go.ke/KRA-Portal/dwr/call/plaincall/CheckLoginPin.checkLoginPin.dwr', {
        cookieJar: jar,
        body,
        headers: {
            'Content-Type': 'text/plain',
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://itax.kra.go.ke/KRA-Portal/',
        },
    });
    console.log('checkLoginPin response:', r.body.slice(0, 500));
}

main().catch((e) => console.error(e.message));
