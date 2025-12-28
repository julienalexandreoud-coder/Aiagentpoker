// AI Agent Player - Content Script
// Handles Calibration UI and Coordinate-based Clicks

let isCalibrationMode = false;
let calibrationTarget = null; // 'FOLD', 'CALL', 'RAISE'
let coords = {};

const IS_TOP_FRAME = window === window.top;

// Load existing coords and state
chrome.storage.local.get(['pokeragent_coords', 'pokeragent_calibrating', 'pokeragent_overlay_pos', 'pokeragent_cal_target'], (result) => {
    if (result.pokeragent_coords) {
        coords = result.pokeragent_coords;
    }

    if (result.pokeragent_calibrating) isCalibrationMode = true;
    if (result.pokeragent_cal_target) calibrationTarget = result.pokeragent_cal_target;

    if (IS_TOP_FRAME) {
        if (isCalibrationMode) {
            initOverlay();
            if (overlay) {
                overlay.style.display = 'block';
                if (result.pokeragent_overlay_pos) {
                    overlay.style.top = result.pokeragent_overlay_pos.y + 'px';
                    overlay.style.left = result.pokeragent_overlay_pos.x + 'px';
                }
            }
            updateMappedInfo();
        } else if (result.pokeragent_overlay_pos && overlay) {
            overlay.style.top = result.pokeragent_overlay_pos.y + 'px';
            overlay.style.left = result.pokeragent_overlay_pos.x + 'px';
        }
    }
});

// Sync calibration state
chrome.storage.onChanged.addListener((changes) => {
    if (changes.pokeragent_calibrating) {
        isCalibrationMode = changes.pokeragent_calibrating.newValue;
        if (IS_TOP_FRAME && overlay) {
            overlay.style.display = isCalibrationMode ? 'block' : 'none';
        }
    }
    if (changes.pokeragent_cal_target) {
        calibrationTarget = changes.pokeragent_cal_target.newValue;
        if (IS_TOP_FRAME && calibrationTarget) {
            const status = document.getElementById('calibration-status');
            if (status) {
                status.innerText = `🎯 CLICK the ${calibrationTarget} button...`;
                status.style.color = '#fbbf24';
            }
            document.documentElement.classList.add('poker-targeting-mode');
        } else if (IS_TOP_FRAME) {
            document.documentElement.classList.remove('poker-targeting-mode');
        }
    }
    if (changes.pokeragent_coords) {
        coords = changes.pokeragent_coords.newValue;
        if (IS_TOP_FRAME) updateMappedInfo();
    }
});

let overlay = null;

function initOverlay() {
    if (!IS_TOP_FRAME || overlay) return;
    if (!document.body) return;

    overlay = document.createElement('div');
    overlay.id = 'ai-agent-player-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        padding: 15px;
        background: rgba(15, 23, 42, 0.95);
        color: white;
        border: 2px solid #8b5cf6;
        border-radius: 12px;
        font-family: 'Inter', sans-serif;
        z-index: 2147483647;
        width: 270px;
        box-shadow: 0 4px 25px rgba(0,0,0,0.6);
        display: none;
        user-select: none;
    `;
    overlay.innerHTML = `
        <div id="drag-handle" style="cursor: grab; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin: 0; color: #a78bfa; font-size: 13px;">🧭 AI Agent <span style="font-size: 9px; opacity: 0.6;">v3.1</span></h3>
            <button id="clear-coords" style="background: none; border: 1px solid #475569; color: #94a3b8; font-size: 8px; padding: 2px 4px; border-radius: 4px; cursor: pointer;">Clear All</button>
        </div>
        <div id="calibration-status" style="font-size: 11px; margin-bottom: 10px; color: #94a3b8;">Status: Waiting</div>
        
        <div id="ai-status-panel" style="background: rgba(0,0,0,0.4); padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid rgba(139, 92, 246, 0.2); display: none;">
            <div id="ai-action-text" style="font-weight: bold; color: #fbbf24; font-size: 18px; text-align: center; text-shadow: 0 0 10px rgba(251, 191, 36, 0.3);">WAITING...</div>
            
            <div id="ai-math-panel" style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 10px;">
                <div style="background: rgba(255,255,255,0.05); padding: 5px; border-radius: 4px;">
                    <div style="opacity: 0.6;">Equity</div>
                    <div id="math-equity" style="color: #4ade80; font-weight: bold;">--</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 5px; border-radius: 4px;">
                    <div style="opacity: 0.6;">Pot Odds</div>
                    <div id="math-odds" style="color: #60a5fa; font-weight: bold;">--</div>
                </div>
                <div style="grid-column: span 2; background: rgba(255,255,255,0.05); padding: 5px; border-radius: 4px;">
                    <div style="opacity: 0.6;">Key Outs</div>
                    <div id="math-outs" style="color: #f472b6;">--</div>
                </div>
            </div>

            <div id="ai-reasoning-text" style="font-size: 10px; color: #94a3b8; margin-top: 8px; line-height: 1.3; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;"></div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr; gap: 6px;">
            <button class="cal-btn" data-target="FOLD" style="background: #1e293b; border: 1px solid #334155; color: white; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px;">Map FOLD</button>
            <button class="cal-btn" data-target="CHECK/CALL" style="background: #1e293b; border: 1px solid #334155; color: white; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px;">Map CHECK/CALL</button>
            <button class="cal-btn" data-target="RAISE" style="background: #1e293b; border: 1px solid #334155; color: white; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px;">Map RAISE</button>
            <button class="cal-btn" data-target="SIT_BACK" style="background: #4c1d95; border: 1px solid #7c3aed; color: white; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px;">Map SIT BACK</button>
        </div>
        <div id="mapped-info" style="margin-top: 10px; font-size: 10px;"></div>
    `;

    // Dragging
    let isDragging = false, offsetX, offsetY;
    overlay.addEventListener('mousedown', (e) => {
        if (e.target.id === 'clear-coords') {
            coords = {};
            chrome.storage.local.set({ pokeragent_coords: coords });
            updateMappedInfo();
            return;
        }
        if (e.target.id === 'drag-handle' || e.target.closest('#drag-handle')) {
            isDragging = true;
            offsetX = e.clientX - overlay.getBoundingClientRect().left;
            offsetY = e.clientY - overlay.getBoundingClientRect().top;
            e.preventDefault();
        }
        if (e.target.classList.contains('cal-btn')) {
            calibrationTarget = e.target.getAttribute('data-target');
            chrome.storage.local.set({ pokeragent_cal_target: calibrationTarget });
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        overlay.style.left = (e.clientX - offsetX) + 'px';
        overlay.style.top = (e.clientY - offsetY) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            chrome.storage.local.set({ pokeragent_overlay_pos: { x: parseInt(overlay.style.left), y: parseInt(overlay.style.top) } });
        }
    });

    document.body.appendChild(overlay);
}

document.addEventListener('click', (e) => {
    if (!isCalibrationMode || !calibrationTarget) return;
    if (overlay && overlay.contains(e.target)) return;

    const x = e.clientX, y = e.clientY;
    coords[calibrationTarget] = { x, y };
    chrome.storage.local.set({ pokeragent_coords: coords, pokeragent_cal_target: null });

    if (IS_TOP_FRAME) {
        updateMappedInfo();
        document.getElementById('calibration-status').innerText = '✅ Mapped!';
    }
    showClickRipple(x, y);
    e.stopPropagation(); e.preventDefault();
}, true);

function updateMappedInfo() {
    const info = document.getElementById('mapped-info');
    let html = '';
    for (const key in coords) html += `<div style="color: #4ade80;">✔ ${key}</div>`;
    info.innerHTML = html;
}

function showClickRipple(x, y) {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${x - 20}px;top:${y - 20}px;width:40px;height:40px;border:4px solid #8b5cf6;border-radius:50%;background:rgba(139,92,246,0.3);pointer-events:none;z-index:2147483647;animation:ripple-out 0.5s ease-out;`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 500);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    initOverlay();
    if (request.type === "TOGGLE_CALIBRATION") {
        isCalibrationMode = request.value;
        if (overlay) overlay.style.display = isCalibrationMode ? 'block' : 'none';
        sendResponse({ status: "ok" });
    }

    if (request.type === "UPDATE_AI_STATUS") {
        if (!IS_TOP_FRAME) return;
        const panel = document.getElementById('ai-status-panel');
        const actionEl = document.getElementById('ai-action-text');
        const reasonEl = document.getElementById('ai-reasoning-text');
        const mEquity = document.getElementById('math-equity');
        const mOdds = document.getElementById('math-odds');
        const mOuts = document.getElementById('math-outs');

        overlay.style.display = 'block';
        panel.style.display = 'block';

        actionEl.innerText = request.action;
        reasonEl.innerText = request.reason;

        if (request.math) {
            mEquity.innerText = request.math.equity || '--';
            mOdds.innerText = request.math.pot_odds || '--';
            mOuts.innerText = request.math.outs || '--';
        } else {
            mEquity.innerText = '--'; mOdds.innerText = '--'; mOuts.innerText = '--';
        }

        const colors = { 'FOLD': '#ef4444', 'CHECK': '#3b82f6', 'CALL': '#22c55e', 'RAISE': '#f59e0b', 'THINKING': '#a78bfa' };
        actionEl.style.color = colors[request.action] || '#fbbf24';
        sendResponse({ status: "updated" });
    }

    if (request.type === "EXECUTE_CLICK") {
        if (coords[request.target]) {
            performNativeClick(coords[request.target].x, coords[request.target].y);
            sendResponse({ status: "clicked" });
        }
    }
    return true;
});

function performNativeClick(x, y) {
    if (IS_TOP_FRAME && overlay) overlay.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (el && !(IS_TOP_FRAME && (el.tagName === 'IFRAME' || el.tagName === 'FRAME'))) {
        const props = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 };
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => el.dispatchEvent(new MouseEvent(t, props)));
        if (typeof el.click === 'function') el.click();
    }
    if (IS_TOP_FRAME && overlay) overlay.style.display = 'block';
}

initOverlay();
const observer = new MutationObserver(() => { if (document.body && !overlay) initOverlay(); });
observer.observe(document.documentElement, { childList: true });

const style = document.createElement('style');
style.textContent = `@keyframes ripple-out { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(2); opacity: 0; } } .poker-targeting-mode * { cursor: crosshair !important; }`;
document.head.appendChild(style);
