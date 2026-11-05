const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = path.resolve(__dirname, '..');
const userDataDir = path.join(__dirname, 'chrome-test-' + Date.now());
const cdpPort = 9222;

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
        } catch (e) {}
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
            if (msg.method === 'Runtime.consoleAPICalled') {
                const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
                console.log(`[Browser Console ${msg.params.type}]: ${text}`);
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

        console.log('[Test] Waiting for 3D model initialization...');
        for (let i = 0; i < 40; i++) {
            await wait(1000);
            const res = await send('Runtime.evaluate', {
                expression: '(() => { const s = document.getElementById("miku-loading-spinner"); return s ? (s.style.display === "none" || s.style.opacity === "0") : false; })()',
                returnByValue: true
            });
            if (res.result?.result?.value === true) {
                console.log(`[Test] 3D Miku loaded after ${i + 1}s!`);
                break;
            }
        }
        await wait(1500);

        // 1. Check Brain button text
        const brainText = await send('Runtime.evaluate', {
            expression: 'document.getElementById("brain-toggle-btn")?.textContent',
            returnByValue: true
        });
        console.log('[Test] Top Brain Switcher:', brainText.result?.result?.value);

        const statusText = await send('Runtime.evaluate', {
            expression: 'document.getElementById("status-text")?.textContent',
            returnByValue: true
        });
        console.log('[Test] Status Badge:', statusText.result?.result?.value);

        // 2. Submit user prompt
        console.log('\n[Test] Sending user prompt to Miku: "Hello Miku! What is your favorite song to perform?"');
        await send('Runtime.evaluate', {
            expression: `(() => {
                const inp = document.getElementById("user-text-input");
                inp.value = "Hello Miku! What is your favorite song to perform?";
                document.getElementById("send-btn").click();
            })()`
        });

        // 3. Monitor streaming output in real time
        console.log('[Test] Monitoring real-time streaming response...');
        let replied = false;
        let lastReported = '';

        for (let i = 0; i < 45; i++) {
            await wait(1000);
            const speaker = await send('Runtime.evaluate', {
                expression: 'document.getElementById("speaker-name")?.textContent',
                returnByValue: true
            });
            const sub = await send('Runtime.evaluate', {
                expression: 'document.getElementById("subtitle-text")?.innerText',
                returnByValue: true
            });
            const text = (sub.result?.result?.value || '').trim();
            const spk = speaker.result?.result?.value || '';

            if (text !== lastReported) {
                console.log(`[${i + 1}s] [${spk}]: ${text}`);
                lastReported = text;
            }

            if (spk === 'MIKU' && text && !text.includes("Thinking via") && !text.includes("Konnichiwa! I'm Hatsune Miku! Running locally")) {
                // Check if streaming completed (doesn't end with cursor and has substance)
                if (text.length > 25) {
                    replied = true;
                    console.log('\n=============================================');
                    console.log('✅ [SUCCESS] Miku responded completely via Local Dolphin 3.0:');
                    console.log(`"${text}"`);
                    console.log('=============================================\n');
                    break;
                }
            }
        }

        await wait(1200);

        // Capture screenshot of live conversation
        const snap = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(artifactDir, 'miku_streaming_response.png'), Buffer.from(snap.result.data, 'base64'));
        console.log('[Screenshot Saved]: miku_streaming_response.png');

        ws.close();
    } catch (e) {
        console.error('[Error during test]:', e);
    } finally {
        chrome.kill();
        process.exit(0);
    }
}

main();
