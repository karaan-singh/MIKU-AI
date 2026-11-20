(async () => {
    const sys = [
        "You are Miku, talking casually one-on-one like a real, down-to-earth human friend.",
        "Rules:",
        "- Talk in plain, natural everyday English (contractions, normal casual tone, no emojis).",
        "- Answer directly and stay grounded in reality. Never invent fake events, never call the user 'my dear friend', and never use dramatic or poetic cliches.",
        "- Keep replies brief: 1 to 2 short, natural sentences."
    ].join('\n');

    const fewShot = [
        { role: 'user', content: 'hey' },
        { role: 'assistant', content: "Hey! What's up? How's your day going?" },
        { role: 'user', content: 'ugh work was exhausting today' },
        { role: 'assistant', content: "Man, I feel that. Long days really drain you—hope you get to kick back and relax tonight." }
    ];

    const testInputs = [
        'hi there',
        'not much, just chilling at my desk. how are you?',
        'wait quick question, coffee or tea?',
        'i am super bored right now, what should i do?',
        'why is the sky blue?',
        'my name is Karan by the way',
        'do you remember my name and which drink i asked about?'
    ];

    const history = [];
    for (const inp of testInputs) {
        let prompt = '<|im_start|>system\n' + sys + '<|im_end|>\n';
        for (const m of [...fewShot, ...history, { role: 'user', content: inp }]) {
            prompt += '<|im_start|>' + m.role + '\n' + m.content + '<|im_end|>\n';
        }
        prompt += '<|im_start|>assistant\n';

        const t0 = performance.now();
        const res = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nchapman/dolphin3.0-qwen2.5:3b',
                prompt,
                raw: true,
                stream: false,
                keep_alive: '30m',
                options: {
                    num_ctx: 1024,
                    num_thread: 4,
                    temperature: 0.45,
                    top_p: 0.85,
                    top_k: 25,
                    repeat_penalty: 1.05,
                    num_predict: 55,
                    stop: ['<|im_end|>', '<|im_start|>', '\nUser:', '\nuser:']
                }
            })
        });
        const d = await res.json();
        const reply = (d.response || '').trim();
        console.log('USER:', inp);
        console.log('MIKU (' + Math.round(performance.now() - t0) + 'ms):', reply);
        console.log('---');
        history.push({ role: 'user', content: inp }, { role: 'assistant', content: reply });
    }
})().catch(console.error);
