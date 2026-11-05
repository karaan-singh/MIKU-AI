git remote add origin https://github.com/karaan-singh/MIKU-AI.gitconst http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\Netware\\.gemini\\antigravity\\brain\\9a7a6412-ee48-4b8a-82c6-680a6e20ef8b';
const userDataDir = path.join(__dirname, 'chrome-test-hist-' + Date.now());
const cdpPort = 9228;

const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,900',
    `--user-data-dir=${userDataDir}`,
    'http://127.0.0.1:8080/index.html'
]);

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getWsUrl() {
    for (let i = 0; i < 30; i++) {
        await wait(500);
        try {
            const data = await new Promise((res, rej) => {
                const req = http.get({ hostname: '127.0.0.1', port: cdpPort, path: '/json' }, resp => {
                    let b = '';
                    resp.on('data', c => b += c);
                    resp.on('end', () => res(b));
                });
                req.on('error', rej);
            });
            const list = JSON.parse(data);
            const page = list.find(p => p.type === 'page');
            if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch (e) { }
    }
    throw new Error('CDP connection failed');
}

async function main() {
    try {
        const wsUrl = await getWsUrl();
        const ws = new WebSocket(wsUrl);
        await new Promise(r => ws.onopen = r);

        let nextId = 1;
        const pending = new Map();

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && pending.has(msg.id)) {
                pending.get(msg.id)(msg);
                pending.delete(msg.id);
            }
        };

        function send(method, params = {}) {
            return new Promise((resolve) => {
                const id = nextId++;
                pending.set(id, resolve);
                ws.send(JSON.stringify({ id, method, params }));
            });
        }

        await send('Runtime.enable');
        await send('Page.enable');

        await wait(2000);

        // Populate sample chat turns and open history modal
        await send('Runtime.evaluate', {
            expression: `(() => {
                window.mikuApp.addChatTurn('user', 'Hello Miku! What is your favorite song?');
                window.mikuApp.addChatTurn('miku', 'Konnichiwa! My favorite song is World is Mine! 🎵', 'cheer', 'My favorite song is World is Mine!');
                window.mikuApp.addChatTurn('user', 'Can you sing in English?');
                window.mikuApp.addChatTurn('miku', 'Of course! I can understand and sing in English, Japanese, and any language! ✨', 'wave', 'Of course! I can sing in English, Japanese, and any language!');
                window.mikuApp.openChatHistory();
            })()`
        });

        await wait(600);

        const snap = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(artifactDir, 'miku_chat_history_transcript.png'), Buffer.from(snap.result.data, 'base64'));
        console.log('[Screenshot Saved]: miku_chat_history_transcript.png');

        ws.close();
    } catch (e) {
        console.error('[Error during test]:', e);
    } finally {
        chrome.kill();
        process.exit(0);
    }
}

main();

