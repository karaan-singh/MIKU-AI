const { spawn } = require('child_process');
const http = require('http');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--no-sandbox',
    '--disable-gpu',
    'http://127.0.0.1:8080/index.html'
]);

setTimeout(async () => {
    try {
        const data = await new Promise((res, rej) => {
            http.get({ hostname: '127.0.0.1', port: 9225, path: '/json' }, r => {
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

        // Dispatch real user click
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
                    console.log('HasBeenActive:', navigator.userActivation.hasBeenActive, 'IsActive:', navigator.userActivation.isActive);
                    const u = new SpeechSynthesisUtterance('Test one');
                    u.onstart = () => console.log('U1 STARTED SUCCESS');
                    u.onerror = (e) => console.log('U1 ERROR:', e.error);
                    window.speechSynthesis.speak(u);

                    setTimeout(() => {
                        console.log('After 6s - HasBeenActive:', navigator.userActivation.hasBeenActive, 'IsActive:', navigator.userActivation.isActive);
                        const u2 = new SpeechSynthesisUtterance('Test two');
                        u2.onstart = () => console.log('U2 STARTED SUCCESS');
                        u2.onerror = (e) => console.log('U2 ERROR:', e.error);
                        window.speechSynthesis.speak(u2);
                    }, 6000);
                `
            }
        }));

        setTimeout(() => {
            ws.close();
            chrome.kill();
            process.exit(0);
        }, 9000);

    } catch (e) {
        console.error('ERR:', e);
        chrome.kill();
        process.exit(1);
    }
}, 2000);

