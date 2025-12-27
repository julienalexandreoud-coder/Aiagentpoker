// AI Agent Player - Popup Script

document.addEventListener('DOMContentLoaded', () => {
    const casinoSelector = document.getElementById('casino-selector');
    const apiKeyInput = document.getElementById('api-key');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const calBtn = document.getElementById('toggle-calibration');
    const statusText = document.getElementById('status-text');

    let isCalibrating = false;

    // 1. Load saved settings
    chrome.storage.local.get(['pokeragent_apikey', 'pokeragent_running', 'pokeragent_casino', 'pokeragent_calibrating'], (result) => {
        if (result.pokeragent_apikey) apiKeyInput.value = result.pokeragent_apikey;
        if (result.pokeragent_casino) casinoSelector.value = result.pokeragent_casino;
        if (result.pokeragent_running) updateUI(true);

        // Sync calibration button state
        if (result.pokeragent_calibrating) {
            isCalibrating = true;
            updateCalBtnUI(true);
        }
    });

    // 2. Event Listeners

    // API Key change
    apiKeyInput.addEventListener('input', () => {
        chrome.runtime.sendMessage({ type: "UPDATE_API_KEY", value: apiKeyInput.value });
    });

    // Casino change
    casinoSelector.addEventListener('change', () => {
        chrome.storage.local.set({ pokeragent_casino: casinoSelector.value });
        chrome.runtime.sendMessage({ type: "UPDATE_CASINO", value: casinoSelector.value });
    });

    // Start Agent
    startBtn.addEventListener('click', () => {
        if (!apiKeyInput.value) {
            statusText.innerText = "❌ Please enter an API Key";
            statusText.style.color = "#ef4444";
            return;
        }
        chrome.runtime.sendMessage({ type: "START_AGENT" }, (response) => {
            updateUI(true);
            chrome.storage.local.set({ pokeragent_running: true });
        });
    });

    // Stop Agent
    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: "STOP_AGENT" }, (response) => {
            updateUI(false);
            chrome.storage.local.set({ pokeragent_running: false });
        });
    });

    // Toggle Calibration
    calBtn.addEventListener('click', () => {
        isCalibrating = !isCalibrating;
        chrome.storage.local.set({ pokeragent_calibrating: isCalibrating });
        updateCalBtnUI(isCalibrating);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_CALIBRATION", value: isCalibrating }, (response) => {
                    if (chrome.runtime.lastError) {
                        statusText.innerText = "⚠️ Please REFRESH the poker page";
                        statusText.style.color = "#fbbf24";
                        console.error(chrome.runtime.lastError);
                    }
                });
            }
        });
    });

    // View Dashboard
    document.getElementById('view-dashboard').addEventListener('click', () => {
        chrome.tabs.create({ url: 'dashboard.html' });
    });

    // 3. Helper Functions

    function updateCalBtnUI(calibrating) {
        calBtn.innerText = calibrating ? "Close Calibration Overlay" : "Toggle Calibration Overlay";
        calBtn.style.background = calibrating ? "#475569" : "#334155";
    }

    function updateUI(running) {
        startBtn.style.display = running ? 'none' : 'block';
        stopBtn.style.display = running ? 'block' : 'none';
        statusText.innerText = running ? "🚀 Agent is Running" : "Ready";
        statusText.style.color = running ? "#4ade80" : "#64748b";
    }
});
