// AI Agent Player - Background Script
// Handles Screenshot Capture, Gemini API, and the Main Loop

let apiKey = '';
let isRunning = false;
let currentCasino = 'pokerstars'; // Default casino
let loopInterval = 4500; // 4.5 seconds to stay under 15 RPM limit
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

        // --- 1. LOCAL CHANGE DETECTION (CRITICAL SIMPLIFICATION) ---
        // Compare with last screenshot to avoid redundant API calls and clicking
        if (screenshot === lastScreenshotData) {
            console.log("⏸️ Table static. Skipping analysis.");
            return;
        }
        lastScreenshotData = screenshot;

        console.log("🧠 Analyzing game state...");
        const analysis = await analyzeWithGemini(screenshot);

        if (analysis && analysis.recommendation) {
            const action = analysis.recommendation.toUpperCase();
            const reasoning = analysis.reasoning || "";
            const isHeroTurn = analysis.is_hero_turn === true;

            // --- 2. TURN VERIFICATION SAFETY ---
            // Poker actions (FOLD/CALL/RAISE) require is_hero_turn = true.
            // SIT_BACK is allowed regardless of turn status.
            const isPokerAction = ["FOLD", "CHECK", "CALL", "RAISE", "BET"].some(a => action.includes(a));

            if (action === "WAIT" || (isPokerAction && !isHeroTurn)) {
                updateOverlayStatus("WAITING", reasoning);
                lastActionState = "";
                return;
            }

            // --- 3. EXECUTION LOCK & RETRY LOGIC ---
            // Create a unique key for this exact hand state and action
            const handKey = `${analysis.hero_cards || '?'}-${analysis.board || '?'}-${action}`;
            const now = Date.now();

            // If it's the SAME state, check if we need to RETRY
            if (handKey === lastActionState) {
                const timeSinceLastAction = now - lastActionTime;

                // If it's been more than 10 seconds and we ARE still in our turn, RETRY ONCE
                if (timeSinceLastAction > 10000 && !didRetryThisState) {
                    console.log("🔄 Same turn persists. Retrying click for reliability...");
                    didRetryThisState = true;
                    lastActionTime = now; // Reset timer for next retry if needed
                } else {
                    return; // Still waiting for UI to update or already retried
                }
            } else {
                // NEW STATE: Reset for fresh action
                lastActionState = handKey;
                lastActionTime = now;
                didRetryThisState = false;
            }

            console.log(`🤖 Action: ${action} (Verified Turn: ${isHeroTurn})`);
            updateOverlayStatus(action, reasoning);

            saveActionToHistory({
                timestamp: new Date().toISOString(),
                action,
                reasoning,
                verified_turn: isHeroTurn
            });

            // Moderate human delay
            const delay = Math.floor(Math.random() * 500) + 600; // Slightly faster delay (600ms - 1100ms)
            setTimeout(() => {
                let target = null;
                if (action.includes('FOLD')) target = 'FOLD';
                else if (action.includes('RAISE') || action.includes('BET')) target = 'RAISE';
                else if (action.includes('CALL') || action.includes('CHECK') || action.includes('IGUALAR')) target = 'CHECK/CALL';
                else if (action.includes('SIT_BACK')) target = 'SIT_BACK';

                if (target) {
                    console.log(`🖱️ Executing verified click on: ${target}`);
                    executeClick(target);
                }
            }, delay);
        }
    } catch (err) {
        if (err.message && err.message.includes("429")) {
            console.error("⛔ API Limit Reached (429). Slowing down...");
            updateOverlayStatus("API LIMIT", "Gemini Limit Reached. Waiting 10s...");
            // Temporary slowdown
            stopLoop();
            setTimeout(() => {
                if (isRunning) startLoop();
            }, 10000);
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
        history.unshift(actionItem); // Add to beginning

        // Keep last 1000 actions
        if (history.length > 1000) history = history.slice(0, 1000);

        chrome.storage.local.set({ pokeragent_history: history });
    });
}

async function captureTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(dataUrl);
            }
        });
    });
}

async function analyzeWithGemini(imageDataUrl) {
    if (!apiKey) throw new Error("API Key missing");

    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

    // Dynamic Prompt Selection
    let prompt = "";

    if (currentCasino === "pokerstars") {
        prompt = `You are an ULTIMATE GTO SOLVER (PioSolver/MonkerSolver class). Analyze the PokerStars screenshot for "SupersaiyanAbun". 

        IDENTITY & TURN VERIFICATION:
        1. LOCATE Hero "SupersaiyanAbun".
        2. VERIFY TURN: It is Hero's turn ONLY if the LARGE RED RECTANGULAR BUTTONS ("No ir", "Igualar", "Subir a") are bottom-right and ACTIVE. 
        3. If not Hero's turn, recommend "WAIT".

        GTO STRATEGIC ANALYSIS (DO NOT SKIP):
        - POT ODDS & EQUITY: Calculate Pot Odds vs estimated Equity.
        - SPR (Stack-to-Pot Ratio): Adjust aggression based on remaining stacks.
        - RANGE ANALYSIS: Determine if Hero's range is Polarity-driven or Linear.
        - COMBINATORICS: Use blockers (card removal) to decide between bluffs and value bets.
        - MDF (Minimum Defense Frequency): Calculate if we must call based on villain's sizing.

        REQUIRED OUTPUT FORMAT (JSON):
        {
            "is_hero_turn": true/false,
            "hero_name": "SupersaiyanAbun",
            "hero_cards": "RankSuit (e.g., AhKd)",
            "board": "RankSuit (e.g., QsJh7d) or 'EMPTY'",
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT/SIT_BACK",
            "reasoning": "COMPREHENSIVE ANALYSIS: [1] CURRENT VALUE: State hand strength (e.g., Top Pair, Nut Flush Draw). [2] PROBABILITY: Estimated % to win. [3] DRAW ANALYSIS: What are we chasing? (e.g., 'Straight draw to the nut 9'). [4] GTO ACTION: Why this sizing/action beats villain's long-term range."
        }`;
    } else if (currentCasino === "winamax") {
        prompt = `You are a PURE GTO MATH SOLVER. Analyze the Winamax screenshot for "Abun122". 
        
        CRITICAL: IGNORE all on-screen advice/labels from Winamax. Use ONLY GTO mathematics.
        
        IDENTITY & TURN VERIFICATION:
        1. LOCATE "Abun122".
        2. VERIFY TURN: Confirmed if LARGE RED ACTION BUTTONS ("NO IR", "IGUALAR", "SUBIR A") are visible at the bottom.
        
        GTO SOLVER PROTOCOL:
        - VALUE IDENTIFICATION: Calculate the expected value (EV) of the current hand.
        - WIN PERCENTAGE: Provide a mathematical estimate of win probability against the opponent's range.
        - CHASE ANALYSIS: Detail what draws we are chasing and the implied odds.
        - EXPLOITATIVE ADJUSTMENT: Balance of value and bluffs.

        REQUIRED OUTPUT FORMAT (JSON):
        {
            "is_hero_turn": true/false,
            "hero_name": "Abun122",
            "hero_cards": "RankSuit (e.g., 9hTs)",
            "board": "RankSuit or 'EMPTY'",
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT/SIT_BACK",
            "reasoning": "GTO BREAKDOWN: [Hand Value: XX%] [Win Prob: XX%] [Targeting: Describe hand being chased] [Detailed Rationale: Explained pot equity vs odds and range blockers.]"
        }`;
    } else {
        // Generic / Fallback Prompt
        prompt = `You are a Poker AI Assistant. Analyze the table and suggest an action.
        
        STEP 1: Identify if it is our turn.
        STEP 2: Identify visible buttons.
        STEP 3: Suggest FOLD/CHECK/CALL/RAISE or WAIT.
        
        JSON format:
        {
            "is_hero_turn": true/false,
            "recommendation": "FOLD/CHECK/CALL/RAISE/WAIT",
            "reasoning": "Explain the decision"
        }`;
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
