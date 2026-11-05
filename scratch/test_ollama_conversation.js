const fetch = globalThis.fetch;

// Mock localStorage if not present
if (typeof localStorage === 'undefined') {
    globalThis.localStorage = {
        _data: {},
        getItem(k) { return this._data[k] || null; },
        setItem(k, v) { this._data[k] = String(v); }
    };
}

const path = require('path');
const { OllamaClient } = require(path.join(__dirname, '../js/ollama.js'));

async function testConversationFlow() {
    console.log("==================================================================");
    console.log("🎤 OLLAMA CONVERSATION & REPLY PERFECTION TEST SUITE");
    console.log("Model: nchapman/dolphin3.0-qwen2.5:3b");
    console.log("==================================================================\n");

    const ollama = new OllamaClient('http://127.0.0.1:11434', 'nchapman/dolphin3.0-qwen2.5:3b');

    const turns = [
        "hii",
        "Hello Miku! Who are you?",
        "What is your favorite song to sing on stage?",
        "Can you write a short 2-line song lyric for me about stars and friendship?",
        "Miku, do you ever get tired from dancing?",
        "今日のコンサートはどうでしたか？",
        "What is 2 + 2?",
        "Why do you love all your fans around the world?"
    ];

    let turnIndex = 1;
    for (const prompt of turns) {
        console.log(`\n👉 [Turn ${turnIndex}] USER: "${prompt}"`);
        const start = performance.now();
        let chunkCount = 0;
        let streamTokens = '';

        try {
            const reply = await ollama.sendMessageStream(
                prompt,
                (chunk) => {
                    chunkCount++;
                    streamTokens = chunk.partialText;
                },
                (action) => {
                    // console.log(`   [Action Triggered]: ${action}`);
                }
            );

            const duration = ((performance.now() - start) / 1000).toFixed(2);
            console.log(`⏱️ Duration: ${duration}s | Tokens/Chunks: ${chunkCount}`);
            console.log(`🎭 Action Gesture: [${reply.action}]`);
            console.log(`💬 Written Text: "${reply.rawText}"`);
            console.log(`🔊 Spoken TTS:   "${reply.speechText}"`);

            // Quality Checks
            if (!reply.rawText || reply.rawText.length < 5) {
                console.log(`❌ ERROR: Reply is too short or empty!`);
            } else if (reply.rawText.toLowerCase().includes('equation') || reply.rawText.toLowerCase().includes('arithmetic')) {
                console.log(`⚠️ WARNING: Math/academic drift detected!`);
            } else {
                console.log(`✅ Turn ${turnIndex} PASS`);
            }
        } catch (e) {
            console.error(`❌ Turn ${turnIndex} FAILED with error:`, e.message);
        }
        turnIndex++;
    }

    console.log("\n==================================================================");
    console.log("Conversation History Recorded (Length:", ollama.history.length, "):");
    console.log(JSON.stringify(ollama.history, null, 2));
    console.log("==================================================================");
}

testConversationFlow();
