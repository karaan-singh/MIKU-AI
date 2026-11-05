const { spawn } = require('child_process');
const http = require('http');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9226',
    '--no-sandbox',
    '--disable-gpu',
    'http://127.0.0.1:8080/index.html'
]);

setTimeout(async () => {
    try {
        const data = await new Promise((res, rej) => {
            http.get({ hostname: '127.0.0.1', port: 9226, path: '/json' }, r => {
                let b = '';
                r.on('data', c => b += c);
                r.on('end', () => res(b));
            }).on('error', rej);
        });
        const list = JSON.parse(data);
        const wsUrl = list[0].webSocketDebuggerUrl;
        const ws = new WebSocket(wsUrl);
        await new Promise(r => ws.onopen = r);

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.method === 'Runtime.consoleAPICalled') {
                console.log('BROWSER LOG:', msg.params.args.map(a => a.value || JSON.stringify(a)).join(' '));
            }
        };

        await ws.send(JSON.stringify({ id: 10, method: 'Runtime.enable' }));

        // Dispatch real click
        ws.send(JSON.stringify({
            id: 1,
            method: 'Input.dispatchMouseEvent',
            params: { type: 'mousePressed', x: 200, y: 200, button: 'left', clickCount: 1 }
        }));
        await new Promise(r => setTimeout(r, 100));
        ws.send(JSON.stringify({
            id: 2,
            method: 'Input.dispatchMouseEvent',
            params: { type: 'mouseReleased', x: 200, y: 200, button: 'left', clickCount: 1 }
        }));
        await new Promise(r => setTimeout(r, 100));

        ws.send(JSON.stringify({
            id: 3,
            method: 'Runtime.evaluate',
            params: {
                expression: `
                    const voices = window.speechSynthesis.getVoices();
                    console.log('Available voices count:', voices.length);

                    for (const v of voices.slice(0, 5)) {
                        const u = new SpeechSynthesisUtterance('Hello from ' + v.name);
                        u.voice = v;
                        u.pitch = 1.18;
                        u.rate = 1.05;
                        u.onstart = () => console.log('PLAYING VOICE:', v.name);
                        u.onerror = (err) => console.log('FAILED VOICE:', v.name, 'Error:', err.error);
                        u.onend = () => console.log('ENDED VOICE:', v.name);
                        window.speechSynthesis.speak(u);
                    }
                `
            }
        }));

        setTimeout(() => {
            ws.close();
            chrome.kill();
            process.exit(0);
        }, 6000);

    } catch (e) {
        console.error('ERR:', e);
        chrome.kill();
        process.exit(1);
    }
}, 2000);

