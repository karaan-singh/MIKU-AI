const http = require('http');
const fs = require('fs');
const WebSocket = globalThis.WebSocket;
const { spawn } = require('child_process');

(async () => {
    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--remote-debugging-port=9224',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1280,720',
        '--autoplay-policy=no-user-gesture-required',
        'http://127.0.0.1:8080/index.html'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    const targets = await new Promise((resolve) => {
        http.get('http://127.0.0.1:9224/json', (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });

    const pageTarget = targets.find(t => t.type === 'page');
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    };

    const send = (method, params = {}) => new Promise((resolve) => {
        const msgId = id++;
        pending.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    await send('Page.enable');
    await new Promise(r => setTimeout(r, 3000));

    // Show a greeting and cheer pose
    await send('Runtime.evaluate', {
        expression: `(() => {
            window.mikuApp.executeMotion("cheer");
            window.mikuApp.showSubtitle("Miku", "Konnichiwa! I am your 3D Hatsune Miku desktop idol! All systems fully verified & running offline! 🎵✨", "cheer");
        })()`
    });

    await new Promise(r => setTimeout(r, 600));

    const snap = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('C:/Users/Netware/.gemini/antigravity/brain/9a7a6412-ee48-4b8a-82c6-680a6e20ef8b/miku_full_live_perfection.png', Buffer.from(snap.result.data, 'base64'));
    console.log('Saved miku_full_live_perfection.png successfully!');
    ws.close();
    chrome.kill();
})().catch(console.error);
