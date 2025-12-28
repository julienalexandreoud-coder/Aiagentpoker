// AI Agent Player - Background Script
// Handles Screenshot Capture, Gemini API, and the Main Loop

let apiKey = '';
let isRunning = false;
let currentCasino = 'pokerstars'; // Default casino
let loopInterval = 3500; // Reduced to 3.5s for faster reaction
let timerId = null;
let lastActionState = ""; // To prevent double-clicking same state/action
let lastActionTime = 0;   // Timestamp of the last successful action recommendation
let didRetryThisState = false; // Flag to allow exactly one retry per state if stuck

// Use Gemini 2.0 Flash for maximum real-time speed
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

        console.log("🧠 Analyzing game state (Real-Time Risk Guard Mode)...");
        const analysis = await analyzeWithGemini(screenshot);

        if (analysis && analysis.recommendation) {
            const action = analysis.recommendation.toUpperCase();
            const reasoning = analysis.reasoning || "";
            const isHeroTurn = analysis.is_hero_turn === true;

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
                if (timeSinceLastAction > 10000 && !didRetryThisState) {
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

            console.log(`🤖 Action: ${action} | Risk Analysis: ${reasoning.split(']')[0]}]`);
            updateOverlayStatus(action, reasoning);

            saveActionToHistory({
                timestamp: new Date().toISOString(),
                action,
                reasoning,
                verified_turn: isHeroTurn
            });

            // Moderate human delay - Optimized for speed
            const delay = Math.floor(Math.random() * 200) + 300;
            setTimeout(async () => {
                let target = null;
                if (action.includes('FOLD')) target = 'FOLD';
                else if (action.includes('RAISE') || action.includes('BET')) target = 'RAISE';
                else if (action.includes('CALL') || action.includes('CHECK') || action.includes('IGUALAR')) target = 'CHECK/CALL';
                else if (action.includes('SIT_BACK')) target = 'SIT_BACK';

                if (target) {
                    // REAL-TIME DOUBLE-CHECK: Re-capture and verify turn is still active
                    console.log("🔍 Pre-Click Verification: Checking if turn is still active...");
                    const finalCheck = await captureTab();
                    const stateCheck = await analyzeWithGemini(finalCheck, true); // Fast check mode

                    if (stateCheck && stateCheck.is_hero_turn) {
                        console.log(`🖱️ Executing verified click on: ${target}`);
                        executeClick(target);
                    } else {
                        console.log("🛑 Pre-Click Verification FAILED: Game state changed. Aborting click.");
                        updateOverlayStatus("ABORTED", "Turn expired or state changed.");
                    }
                }
            }, delay);
        }
    } catch (err) {
        if (err.message && err.message.includes("429")) {
            console.error("⛔ API Limit. Slowing down...");
            updateOverlayStatus("API LIMIT", "Waiting 10s...");
            stopLoop();
            setTimeout(() => { if (isRunning) startLoop(); }, 10000);
        } else {
            console.error("❌ Loop Error:", err);
            updateOverlayStatus("ERROR", err.message || "Unknown error");
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

function updateOverlayStatus(action, reason) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.webNavigation.getAllFrames({ tabId: tabs[0].id }, (frames) => {
                frames.forEach(frame => {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: "UPDATE_AI_STATUS",
                        action,
                        reason,
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
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 }, (dataUrl) => { // Quality 70 for speed
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
        prompt = `QUICK CHECK: Is it Hero's turn? Look for LARGE RED ACTION BUTTONS bottom right. Respond ONLY with JSON: { "is_hero_turn": true/false }`;
    } else if (currentCasino === "pokerstars") {
        prompt = `You are an ULTIMATE GTO SOLVER with a STRICT RISK MANAGEMENT protocol. Analyze for "SupersaiyanAbun".

        RISK MANAGEMENT PROTOCOL (SAFETY FIRST):
        - NO ALL-IN: Never recommend "ALL-IN" or putting the entire stack at risk unless you have the ABSOLUTE NUTS (the best possible hand).
        - TRASH FILTER: If "SupersaiyanAbun" has hands like 72, 94, J3 (unsuited, unconnected trash), FOLD immediately if there is any bet from opponents, regardless of potential.
        - POT LIMITATION: Prioritize small/medium pots. Avoid high-variance bluffs.
        - BANKROLL PROTECTION: If the risk of losing the hand outweighs the EV by a factor of 2:1, favor the FOLD or CHECK.

        IDENTITY & TURN VERIFICATION:
        1. LOCATE Hero "SupersaiyanAbun".
        2. VERIFY TURN: It is Hero's turn ONLY if the LARGE RED RECTANGULAR BUTTONS ("No ir", "Igualar", "Subir a") are bottom-right and ACTIVE. 

        REQUIRED OUTPUT FORMAT (JSON):
        {
            "is_hero_turn": true/false,
            "hero_name": "SupersaiyanAbun",
            "hero_cards": "RankSuit",
            "board": "RankSuit",
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT/SIT_BACK",
            "reasoning": "RISK EVALUATION: [Risk Level: Low/Med/High] [Hand Quality: Trash/Mediocre/Strong] [Why this action protects the stack: Detailed GTO explanation focusing on safety over greed.]"
        }`;
    } else if (currentCasino === "winamax") {
        prompt = `You are a PURE GTO MATH SOLVER with a CONSERVATIVE RISK PROFILE. Analyze for "Abun122". 

        CRITICAL RISK RULES:
        - FORBIDDEN ACTION: NEVER recommend "ALL-IN" for bluffs. Only "ALL-IN" with 95%+ win probability.
        - VALUE OVER BLUFF: Do not play high amounts with weak/speculative hands. 
        - ESCAPE ROUTE: If the opponent displays extreme aggression (3-bet/4-bet), FOLD unless holding a Premium pair (JJ+).

        IDENTITY & TURN VERIFICATION:
        1. LOCATE "Abun122".
        2. VERIFY TURN: Confirmed if LARGE RED ACTION BUTTONS ("NO IR", "IGUALAR", "SUBIR A") are visible.

        REQUIRED OUTPUT FORMAT (JSON):
        {
            "is_hero_turn": true/false,
            "hero_name": "Abun122",
            "hero_cards": "RankSuit",
            "board": "RankSuit",
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT/SIT_BACK",
            "reasoning": "CONSERVATIVE BREAKDOWN: [Risk: XX%] [Asset Protection: Why we chose not to risk more chips] [GTO Safety Analysis: Logic for avoiding the All-In path.]"
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
