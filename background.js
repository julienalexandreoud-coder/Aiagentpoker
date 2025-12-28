// AI Agent Player - Background Script
// Handles Screenshot Capture, Gemini API, and Real-Time State Sync

let apiKey = '';
let isRunning = false;
let currentCasino = 'pokerstars'; // Default casino
let loopInterval = 3000; // 3s polling for real-time response
let timerId = null;
let lastActionState = ""; // To prevent double-clicking same state/action
let lastActionTime = 0;   // Timestamp of the last successful action recommendation
let didRetryThisState = false;

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
        lastActionState = "";
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
    console.log("🚀 AI Agent: Starting Speed Engine loop...");
    timerId = setInterval(processTick, loopInterval);
    processTick();
}

function stopLoop() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    console.log("🛑 AI Agent: Loop stopped.");
}

let lastScreenshotData = null;

async function processTick() {
    if (!isRunning || !apiKey) return;

    try {
        const screenshot = await captureTab();

        // --- local change detection ---
        if (screenshot === lastScreenshotData) return;
        lastScreenshotData = screenshot;

        console.log("🧠 Analyzing (Immediate Action Mode)...");
        const analysis = await analyzeWithGemini(screenshot);

        if (analysis && analysis.recommendation) {
            const action = analysis.recommendation.toUpperCase();
            const reasoning = analysis.reasoning || "";
            const isHeroTurn = analysis.is_hero_turn === true;
            const math = analysis.math || null;

            const isPokerAction = ["FOLD", "CHECK", "CALL", "RAISE", "BET"].some(a => action.includes(a));

            if (action === "WAIT" || (isPokerAction && !isHeroTurn)) {
                updateOverlayStatus("WAITING", reasoning, math);
                lastActionState = "";
                return;
            }

            const handKey = `${analysis.hero_cards || '?'}-${analysis.board || '?'}-${action}`;
            const now = Date.now();

            if (handKey === lastActionState) {
                const timeSinceLastAction = now - lastActionTime;
                if (timeSinceLastAction > 10000 && !didRetryThisState) {
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

            console.log(`🤖 Action detected: ${action}`);
            updateOverlayStatus("ACTING", `Executing ${action}...`, math);

            saveActionToHistory({
                timestamp: new Date().toISOString(),
                action,
                math,
                reasoning,
                verified_turn: isHeroTurn
            });

            // Minor random delay for stability (300-500ms)
            const clickDelay = Math.floor(Math.random() * 200) + 300;

            setTimeout(async () => {
                if (!isRunning) return;

                let target = null;
                if (action.includes('FOLD')) target = 'FOLD';
                else if (action.includes('RAISE') || action.includes('BET')) target = 'RAISE';
                else if (action.includes('CALL') || action.includes('CHECK') || action.includes('IGUALAR')) target = 'CHECK/CALL';
                else if (action.includes('SIT_BACK')) target = 'SIT_BACK';

                if (target) {
                    // Final verification to ensure turn is still active
                    const finalCheck = await captureTab();
                    const stateCheck = await analyzeWithGemini(finalCheck, true);

                    if (stateCheck && stateCheck.is_hero_turn) {
                        console.log(`🖱️ Executing action: ${target}`);
                        updateOverlayStatus(action, reasoning, math);
                        executeClick(target);
                    } else {
                        console.log("🛑 Turn expired during analysis. Aborting click.");
                        updateOverlayStatus("EXPIRED", "Table updated.", null);
                    }
                }
            }, clickDelay);
        }
    } catch (err) {
        if (err.message && err.message.includes("429")) {
            updateOverlayStatus("API LIMIT", "Waiting 15s...", null);
            stopLoop();
            setTimeout(() => { if (isRunning) startLoop(); }, 15000);
        } else {
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

async function captureTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 }, (dataUrl) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(dataUrl);
        });
    });
}

async function analyzeWithGemini(imageDataUrl, isFastCheck = false) {
    if (!apiKey) throw new Error("API Key missing");
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    let prompt = "";

    if (isFastCheck) {
        prompt = `QUICK CHECK: Is Hero turn? { "is_hero_turn": true/false }`;
    } else {
        const hero = currentCasino === 'winamax' ? 'Abun122' : 'SupersaiyanAbun';
        prompt = `You are an ULTRA-CONSERVATIVE GTO SOLVER. Analyze for "${hero}".
        MANDATORY: FOLD if EV is not clearly positive.
        JSON format: { "is_hero_turn": true/false, "math": { "equity": "XX%", "pot_odds": "X:X", "outs": "X", "ev": "Pos/Neg" }, "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT", "reasoning": "..." }`;
    }

    const body = {
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64Data } }] }],
        generationConfig: { temperature: 0.1, response_mime_type: "application/json" }
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`API Error: ${await response.text()}`);
    const data = await response.json();
    return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
}
