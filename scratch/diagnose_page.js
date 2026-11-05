const http = require('http');
const { spawn } = require('child_process');

(async () => {
    const cdpPort = 9355;
    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        '--no-sandbox',
        '--disable-gpu',
        'http://127.0.0.1:8080/index.html'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    const targets = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${cdpPort}/json`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });

    const page = targets.find(t => t.type === 'page');
    const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Runtime.consoleAPICalled') {
            console.log(`[Console ${msg.params.type}]:`, ...msg.params.args.map(a => a.value || JSON.stringify(a)));
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[Exception]:', msg.params.exceptionDetails);
        }
    };

    let id = 1;
    const send = (method, params = {}) => new Promise((res) => {
        const msgId = id++;
        const h = (e) => {
            const m = JSON.parse(e.data);
            if (m.id === msgId) {
                ws.removeEventListener('message', h);
                res(m);
            }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.reload');

    await new Promise(r => setTimeout(r, 8000));

    const html = await send('Runtime.evaluate', {
        expression: '({ spinner: document.getElementById("miku-loading-spinner")?.style.display, error: document.getElementById("miku-error-message")?.textContent })',
        returnByValue: true
    });
    console.log('Status on page:', html.result?.result?.value);

    ws.close();
    chrome.kill();
})().catch(console.error);

