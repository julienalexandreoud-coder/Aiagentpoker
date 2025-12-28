// AI Agent Player - Background Script
// Handles Screenshot Capture, Gemini API, and the Main Loop

let apiKey = '';
let isRunning = false;
let currentCasino = 'pokerstars'; // Default casino
let loopInterval = 6000; // 6 seconds for slower state scanning
let timerId = null;
let lastActionState = ""; // To prevent double-clicking same state/action
let lastActionTime = 0;   // Timestamp of the last successful action recommendation
let didRetryThisState = false; // Flag to allow exactly one retry per state if stuck

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Load settings
chrome.storage.local.get(['pokeragent_apikey', 'pokeragent_casino'], (result) => {
    if (result.pokeragent_apikey) apiKey = result.pokeragent_apikey;
    if (result.pokeragent_casino) currentCasino = result.pokeragent_casino;
});

// Listening for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "START_AGENT") {
        isRunning = true;
        lastActionState = ""; // Reset on start
        startLoop();
        sendResponse({ status: "started" });
    }
    if (request.type === "STOP_AGENT") {
        isRunning = false;
        stopLoop();
        sendResponse({ status: "stopped" });
    }
    if (request.type === "UPDATE_API_KEY") {
        apiKey = request.value;
        chrome.storage.local.set({ pokeragent_apikey: apiKey });
        sendResponse({ status: "updated" });
    }
    if (request.type === "UPDATE_CASINO") {
        currentCasino = request.value;
        console.log(`🎰 Casino changed to: ${currentCasino}`);
        sendResponse({ status: "updated" });
    }
    return true;
});

function startLoop() {
    if (timerId) clearInterval(timerId);
    console.log("🚀 AI Agent: Starting main loop...");
    timerId = setInterval(processTick, loopInterval);
    processTick(); // Run once immediately
}

function stopLoop() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    console.log("🛑 AI Agent: Loop stopped.");
}

let lastScreenshotData = null; // For local change detection

async function processTick() {
    if (!isRunning || !apiKey) return;

    try {
        const screenshot = await captureTab();

        // --- local change detection ---
        if (screenshot === lastScreenshotData) {
            console.log("⏸️ Table static. Skipping analysis.");
            return;
        }
        lastScreenshotData = screenshot;

        console.log("🧠 Analyzing game state (Visual Math Mode)...");
        const analysis = await analyzeWithGemini(screenshot);

        if (analysis && analysis.recommendation) {
            const action = analysis.recommendation.toUpperCase();
            const reasoning = analysis.reasoning || "";
            const isHeroTurn = analysis.is_hero_turn === true;
            const math = analysis.math || null;

            const isPokerAction = ["FOLD", "CHECK", "CALL", "RAISE", "BET"].some(a => action.includes(a));

            if (action === "WAIT" || (isPokerAction && !isHeroTurn)) {
                updateOverlayStatus("WAITING", reasoning);
                lastActionState = "";
                return;
            }

            const handKey = `${analysis.hero_cards || '?'}-${analysis.board || '?'}-${action}`;
            const now = Date.now();

            if (handKey === lastActionState) {
                const timeSinceLastAction = now - lastActionTime;
                if (timeSinceLastAction > 15000 && !didRetryThisState) {
                    console.log("🔄 Same turn persists. Retrying click...");
                    didRetryThisState = true;
                    lastActionTime = now;
                } else {
                    return;
                }
            } else {
                lastActionState = handKey;
                lastActionTime = now;
                didRetryThisState = false;
            }

            console.log(`🤖 Action: ${action}`);

            // 10-SECOND THINKING DELAY
            const thinkingDelay = 10000;
            updateOverlayStatus("THINKING", `Evaluating Math Data...`, math);
            console.log(`⏳ Thinking... Will act in 10s.`);

            saveActionToHistory({
                timestamp: new Date().toISOString(),
                action,
                math,
                reasoning,
                verified_turn: isHeroTurn
            });

            setTimeout(async () => {
                if (!isRunning) return;

                let target = null;
                if (action.includes('FOLD')) target = 'FOLD';
                else if (action.includes('RAISE') || action.includes('BET')) target = 'RAISE';
                else if (action.includes('CALL') || action.includes('CHECK') || action.includes('IGUALAR')) target = 'CHECK/CALL';
                else if (action.includes('SIT_BACK')) target = 'SIT_BACK';

                if (target) {
                    const finalCheck = await captureTab();
                    const stateCheck = await analyzeWithGemini(finalCheck, true);

                    if (stateCheck && stateCheck.is_hero_turn) {
                        console.log(`🖱️ Executing verified click on: ${target}`);
                        updateOverlayStatus(action, reasoning, math);
                        executeClick(target);
                    } else {
                        console.log("🛑 State changed during thinking. Aborting.");
                        updateOverlayStatus("ABORTED", "Turn expired.", null);
                    }
                }
            }, thinkingDelay);
        }
    } catch (err) {
        if (err.message && err.message.includes("429")) {
            console.error("⛔ API Limit. Slowing down...");
            updateOverlayStatus("API LIMIT", "Waiting 10s...", null);
            stopLoop();
            setTimeout(() => { if (isRunning) startLoop(); }, 10000);
        } else {
            console.error("❌ Loop Error:", err);
            updateOverlayStatus("ERROR", err.message || "Unknown error", null);
        }
    }
}

function executeClick(target) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.webNavigation.getAllFrames({ tabId: tabs[0].id }, (frames) => {
                frames.forEach(frame => {
                    chrome.tabs.sendMessage(tabs[0].id, { type: "EXECUTE_CLICK", target }, { frameId: frame.frameId });
                });
            });
        }
    });
}

function updateOverlayStatus(action, reason, math = null) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.webNavigation.getAllFrames({ tabId: tabs[0].id }, (frames) => {
                frames.forEach(frame => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: "UPDATE_AI_STATUS",
                        action,
                        reason,
                        math,
                        time: new Date().toLocaleTimeString()
                    }, { frameId: frame.frameId });
                });
            });
        }
    });
}

function saveActionToHistory(actionItem) {
    chrome.storage.local.get(['pokeragent_history'], (result) => {
        let history = result.pokeragent_history || [];
        history.unshift(actionItem);
        if (history.length > 1000) history = history.slice(0, 1000);
        chrome.storage.local.set({ pokeragent_history: history });
    });
}

async function captureTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(dataUrl);
            }
        });
    });
}

async function analyzeWithGemini(imageDataUrl, isFastCheck = false) {
    if (!apiKey) throw new Error("API Key missing");

    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    let prompt = "";

    if (isFastCheck) {
        prompt = `QUICK CHECK: Is it Hero's turn? Respond ONLY with JSON: { "is_hero_turn": true/false }`;
    } else if (currentCasino === "pokerstars") {
        prompt = `You are an ULTRA-CONSERVATIVE GTO SOLVER. Analyze for "SupersaiyanAbun".

        MATHEMATICAL ANALYSIS RULES:
        1. Calculate Equity vs Range.
        2. Calculate Pot Odds.
        3. Identify specific Outs.
        4. MANDATORY FOLD if EV is not clearly positive.

        REQUIRED OUTPUT FORMAT (JSON):
        {
            "is_hero_turn": true/false,
            "math": {
                "equity": "XX%",
                "pot_odds": "X:X",
                "outs": "Count and names",
                "ev": "Positive/Negative/Neutral"
            },
            "hero_cards": "RankSuit",
            "board": "RankSuit",
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT",
            "reasoning": "Detailed GTO path."
        }`;
    } else if (currentCasino === "winamax") {
        prompt = `You are a PURE GTO MATH SOLVER. Analyze for "Abun122". 
        
        REQUIRED OUTPUT FORMAT (JSON):
        {
            "is_hero_turn": true/false,
            "math": {
                "equity": "XX%",
                "pot_odds": "X:X",
                "outs": "Count and names",
                "ev": "Positive/Negative/Neutral"
            },
            "hero_cards": "RankSuit",
            "board": "RankSuit",
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT",
            "reasoning": "Detailed GTO path."
        }`;
    } else {
        prompt = `You are a Poker AI. JSON only: { "is_hero_turn": true/false, "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT", "reasoning": "..." }`;
    }

    const body = {
        contents: [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json"
        }
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API Error: ${err}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text);
}
