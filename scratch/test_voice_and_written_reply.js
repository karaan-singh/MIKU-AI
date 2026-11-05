const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\Netware\\.gemini\\antigravity\\brain\\9a7a6412-ee48-4b8a-82c6-680a6e20ef8b';
const userDataDir = path.join(__dirname, 'chrome-test-vwr-' + Date.now());
const cdpPort = 9227;

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

        // Real user click on document body to grant browser user activation
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 250, y: 250, button: 'left', clickCount: 1 });
        await wait(50);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 250, y: 250, button: 'left', clickCount: 1 });
        await wait(100);

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

        // Verify dialogue UI buttons exist
        const replayBtn = await send('Runtime.evaluate', {
            expression: '!!document.getElementById("btn-replay-voice")',
            returnByValue: true
        });
        const historyBtn = await send('Runtime.evaluate', {
            expression: '!!document.getElementById("btn-toggle-chat-log")',
            returnByValue: true
        });
        console.log(`[Test] Replay Voice button present: ${replayBtn.result?.result?.value}`);
        console.log(`[Test] Chat History button present: ${historyBtn.result?.result?.value}`);

        // Submit user prompt
        console.log('\n[Test] Sending prompt: "Tell me a short fun fact about yourself!"');
        await send('Runtime.evaluate', {
            expression: `(() => {
                const inp = document.getElementById("user-text-input");
                inp.value = "Tell me a short fun fact about yourself!";
                document.getElementById("send-btn").click();
            })()`
        });

        // Verify User prompt context is displayed
        await wait(500);
        const userPrompt = await send('Runtime.evaluate', {
            expression: 'document.getElementById("dialogue-user-text")?.textContent',
            returnByValue: true
        });
        console.log('[Test] User prompt context in dialogue card:', userPrompt.result?.result?.value);

        // Wait for Miku written response & voice execution
        console.log('[Test] Waiting for Miku written reply and voice output...');
        let finished = false;

        for (let i = 0; i < 45; i++) {
            await wait(1000);
            const sub = await send('Runtime.evaluate', {
                expression: 'document.getElementById("subtitle-text")?.innerText',
                returnByValue: true
            });
            const status = await send('Runtime.evaluate', {
                expression: 'document.getElementById("status-text")?.textContent',
                returnByValue: true
            });
            const text = (sub.result?.result?.value || '').trim();

            console.log(`[${i + 1}s] Status: "${status.result?.result?.value}" | Text: "${text.slice(0, 60)}..."`);

            if (text && !text.includes("Thinking via") && !text.includes("Konnichiwa! I'm Hatsune Miku! Running locally")) {
                if (status.result?.result?.value.includes("Speaking") || status.result?.result?.value.includes("Ready")) {
                    console.log('\n=============================================');
                    console.log('✅ [SUCCESS] Written Response Present:');
                    console.log(`"${text}"`);
                    console.log('=============================================\n');
                    finished = true;
                    break;
                }
            }
        }

        await wait(1500);

        // Test Replay Voice Button
        console.log('[Test] Testing "🔊 Replay Voice" button click...');
        await send('Runtime.evaluate', {
            expression: 'document.getElementById("btn-replay-voice")?.click()'
        });
        await wait(1000);

        const replayStatus = await send('Runtime.evaluate', {
            expression: 'document.getElementById("status-text")?.textContent',
            returnByValue: true
        });
        console.log('[Test] Status after Replay Voice click:', replayStatus.result?.result?.value);

        // Test Chat History Modal
        console.log('[Test] Testing "💬 History" modal...');
        await send('Runtime.evaluate', {
            expression: 'document.getElementById("btn-toggle-chat-log")?.click()'
        });
        await wait(800);

        const historyCount = await send('Runtime.evaluate', {
            expression: 'document.querySelectorAll(".chat-turn").length',
            returnByValue: true
        });
        console.log(`[Test] Total written chat turns recorded in transcript: ${historyCount.result?.result?.value}`);

        // Capture screenshot of written text & voice interface
        const snap = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(artifactDir, 'miku_voice_and_written_text.png'), Buffer.from(snap.result.data, 'base64'));
        console.log('[Screenshot Saved]: miku_voice_and_written_text.png');

        ws.close();
    } catch (e) {
        console.error('[Error during test]:', e);
    } finally {
        chrome.kill();
        process.exit(0);
    }
}

main();

