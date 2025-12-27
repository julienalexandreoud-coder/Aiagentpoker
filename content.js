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
        console.log("📍 AI Agent: Loaded coords", coords);
    }

    // Sync calibration state
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

// Listen for storage changes (Sync across frames)
chrome.storage.onChanged.addListener((changes) => {
    if (changes.pokeragent_calibrating) {
        isCalibrationMode = changes.pokeragent_calibrating.newValue;
        if (IS_TOP_FRAME && overlay) {
            overlay.style.display = isCalibrationMode ? 'block' : 'none';
            if (isCalibrationMode) updateMappedInfo();
        }
    }
    if (changes.pokeragent_cal_target) {
        calibrationTarget = changes.pokeragent_cal_target.newValue;
        if (IS_TOP_FRAME && calibrationTarget) {
            const status = document.getElementById('calibration-status');
            if (status) {
                status.innerText = `🎯 Now CLICK the ${calibrationTarget} button on your game...`;
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

// Create Overlay
let overlay = null;

function initOverlay() {
    if (!IS_TOP_FRAME) return; // Overlay only in top frame
    if (overlay) return; // Already exists
    if (!document.body) return; // Body not ready yet

    overlay = document.createElement('div');
    overlay.id = 'ai-agent-player-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        padding: 15px;
        background: rgba(15, 23, 42, 0.9);
        color: white;
        border: 2px solid #8b5cf6;
        border-radius: 12px;
        font-family: 'Inter', sans-serif;
        z-index: 2147483647;
        width: 250px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        display: none;
        user-select: none;
    `;
    overlay.innerHTML = `
        <div id="drag-handle" style="cursor: grab; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div style="pointer-events: none;">
                <h3 style="margin: 0; color: #a78bfa; font-size: 13px;">🧭 AI Agent <span style="font-size: 9px; opacity: 0.6;">v2.6</span></h3>
                <div style="font-size: 9px; color: #64748b;">Drag header to move</div>
            </div>
            <button id="clear-coords" style="background: none; border: 1px solid #475569; color: #94a3b8; font-size: 8px; padding: 2px 4px; border-radius: 4px; cursor: pointer;">Clear All</button>
        </div>
        <div id="calibration-status" style="font-size: 11px; margin-bottom: 10px; color: #94a3b8;">
            Select a button, then click the table.
        </div>
        <div id="ai-status-panel" style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.1); display: none;">
            <div id="ai-action-text" style="font-weight: bold; color: #fbbf24; font-size: 16px; text-align: center;">WAITING...</div>
            <div id="ai-reasoning-text" style="font-size: 10px; color: #94a3b8; margin-top: 4px; line-height: 1.2;"></div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
            <button class="cal-btn" data-target="FOLD" style="background: #334155; border: 1px solid #475569; color: white; padding: 6px; border-radius: 6px; cursor: pointer;">Map FOLD</button>
            <button class="cal-btn" data-target="CHECK/CALL" style="background: #334155; border: 1px solid #475569; color: white; padding: 6px; border-radius: 6px; cursor: pointer;">Map CHECK/CALL</button>
            <button class="cal-btn" data-target="RAISE" style="background: #334155; border: 1px solid #475569; color: white; padding: 6px; border-radius: 6px; cursor: pointer;">Map RAISE</button>
            <button class="cal-btn" data-target="SIT_BACK" style="background: #4C1D95; border: 1px solid #7C3AED; color: white; padding: 6px; border-radius: 6px; cursor: pointer;">Map SIT BACK</button>
        </div>
        <div id="mapped-info" style="margin-top: 10px; font-size: 11px;"></div>
    `;

    // Handle Dragging
    let isDragging = false;
    let offsetX, offsetY;

    overlay.addEventListener('mousedown', (e) => {
        // Clear Coords Button
        if (e.target.id === 'clear-coords') {
            coords = {};
            chrome.storage.local.set({ pokeragent_coords: coords });
            updateMappedInfo();
            e.stopPropagation();
            return;
        }

        if (e.target.id === 'drag-handle' || e.target.closest('#drag-handle')) {
            isDragging = true;
            document.getElementById('drag-handle').style.cursor = 'grabbing';
            offsetX = e.clientX - overlay.getBoundingClientRect().left;
            offsetY = e.clientY - overlay.getBoundingClientRect().top;
            e.stopPropagation();
            e.preventDefault();
        }

        // Handle Calibration Button Presses
        if (e.target.classList.contains('cal-btn')) {
            calibrationTarget = e.target.getAttribute('data-target');
            chrome.storage.local.set({ pokeragent_cal_target: calibrationTarget });
            e.stopPropagation();
            e.preventDefault();
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
            const handle = overlay.querySelector('#drag-handle');
            handle.style.cursor = 'grab';

            // Save position
            const pos = {
                x: parseInt(overlay.style.left),
                y: parseInt(overlay.style.top)
            };
            chrome.storage.local.set({ pokeragent_overlay_pos: pos });
        }
    });

    document.body.appendChild(overlay);
    console.log("✅ AI Agent: Overlay initialized.");
}

// Try to init on load
initOverlay();

// Defensive check: if body takes time
const observer = new MutationObserver(() => {
    if (document.body && !overlay) {
        initOverlay();
        observer.disconnect();
    }
});
observer.observe(document.documentElement, { childList: true });

// Capture Global Clicks during Calibration
// Using 'click' and 'true' (capture phase) to beat site-level stopPropagation
document.addEventListener('click', (e) => {
    if (!isCalibrationMode || !calibrationTarget) return;

    // Don't capture if clicking our own overlay
    if (overlay && overlay.contains(e.target)) {
        console.log("🚫 AI Agent: Click ignored (inside overlay)");
        return;
    }

    const x = e.clientX;
    const y = e.clientY;

    console.log(`✨ AI Agent: Captured click at (${x}, ${y}) for ${calibrationTarget}`);

    coords[calibrationTarget] = { x, y };

    // Every frame saves its captured click to global storage
    chrome.storage.local.set({ pokeragent_coords: coords, pokeragent_cal_target: null }, () => {
        console.log(`💾 AI Agent (${IS_TOP_FRAME ? 'TOP' : 'FRAME'}): Coords saved.`);
    });

    if (IS_TOP_FRAME) {
        updateMappedInfo();
        document.getElementById('calibration-status').innerText = '✅ Mapped! Select another or exit.';
        document.getElementById('calibration-status').style.color = '#4ade80';
        document.body.style.cursor = 'default';
    }

    // Highlight the spot briefly
    showClickRipple(x, y);

    // Stop execution
    e.stopPropagation();
    e.preventDefault();

}, true);

function updateMappedInfo() {
    const info = document.getElementById('mapped-info');
    let html = '';

    // Cleanup markers (in case any remained)
    document.querySelectorAll('.poker-cal-marker').forEach(m => m.remove());

    for (const key in coords) {
        html += `<div style="color: #4ade80; margin-bottom: 2px;">✔ ${key}: (${coords[key].x}, ${coords[key].y})</div>`;
    }
    info.innerHTML = html;
}

function showClickRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.style.cssText = `
        position: fixed;
        left: ${x - 20}px;
        top: ${y - 20}px;
        width: 40px;
        height: 40px;
        border: 4px solid #8b5cf6;
        border-radius: 50%;
        background: rgba(139, 92, 246, 0.3);
        pointer-events: none;
        z-index: 2147483647;
        animation: ripple-out 0.5s ease-out;
    `;
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
}

// Global Message Listener (from Background or Popup)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    initOverlay(); // Ensure overlay exists on any message
    if (!overlay && IS_TOP_FRAME) {
        sendResponse({ status: "error", message: "Overlay not initialized" });
        return true;
    }

    if (request.type === "TOGGLE_CALIBRATION") {
        isCalibrationMode = request.value;
        if (overlay) overlay.style.display = isCalibrationMode ? 'block' : 'none';

        // Cleanup markers if closing
        if (!isCalibrationMode) {
            document.querySelectorAll('.poker-cal-marker').forEach(m => m.remove());
        } else if (IS_TOP_FRAME) {
            updateMappedInfo();
        }
        sendResponse({ status: "ok" });
    }

    if (request.type === "UPDATE_AI_STATUS") {
        if (!IS_TOP_FRAME) return; // Only top frame shows status
        const panel = document.getElementById('ai-status-panel');
        const actionEl = document.getElementById('ai-action-text');
        const reasonEl = document.getElementById('ai-reasoning-text');

        overlay.style.display = 'block';
        panel.style.display = 'block';

        actionEl.innerText = `${request.action}`;
        reasonEl.innerHTML = `
            <div style="color: #a78bfa; font-size: 9px; margin-bottom: 4px;">
                Last Check: ${request.time}
            </div>
            ${request.reason}
        `;

        const colors = {
            'FOLD': '#ef4444',
            'CHECK': '#3b82f6',
            'CALL': '#22c55e',
            'RAISE': '#f59e0b',
            'BET': '#f59e0b',
            'WAITING': '#94a3b8',
            'EMERGENCY STOP': '#ff0000',
            'VERIFYING': '#8b5cf6',
            'ABORTED': '#ec4899'
        };
        actionEl.style.color = colors[request.action] || '#fbbf24';

        actionEl.style.transform = 'scale(1.1)';
        setTimeout(() => actionEl.style.transform = 'scale(1)', 200);

        sendResponse({ status: "updated" });
    }

    if (request.type === "EXECUTE_CLICK") {
        const target = request.target; // 'FOLD', 'CHECK/CALL', 'RAISE'
        if (coords[target]) {
            const { x, y } = coords[target];
            performNativeClick(x, y);
            sendResponse({ status: "clicked", x, y });
        } else {
            sendResponse({ status: "not_mapped", target });
        }
    }
    return true;
});

// Perform "Undetectable" Click
function performNativeClick(x, y) {
    console.log(`🚀 AI Agent (${IS_TOP_FRAME ? 'TOP' : 'FRAME'}): Executing click at (${x}, ${y})`);

    // 1. Temporarily hide overlay (only if in top frame)
    let oldDisplay = "";
    if (IS_TOP_FRAME && overlay) {
        oldDisplay = overlay.style.display;
        overlay.style.display = 'none';
        showClickRipple(x, y);
    }

    try {
        const el = document.elementFromPoint(x, y);
        if (!el) return;

        // If it's an iframe and we are in the top frame, we ALREADY broadcasted to it.
        // We stop here to let the frame internal script handle it.
        if (IS_TOP_FRAME && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
            console.log("⏩ AI Agent: Found iframe. Delegating to internal script.");
            return;
        }

        console.log(`🎯 AI Agent: Clicking element <${el.tagName.toLowerCase()}> - ID: ${el.id || 'none'}`);

        const commonProps = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            buttons: 1
        };

        // Standard MouseEvent sequence (Gold Standard for many browser-based games)
        el.dispatchEvent(new MouseEvent('mouseover', commonProps));
        el.dispatchEvent(new MouseEvent('mousedown', commonProps));
        el.dispatchEvent(new MouseEvent('mouseup', commonProps));
        el.dispatchEvent(new MouseEvent('click', commonProps));

        // Native legacy fallback
        if (typeof el.click === 'function') el.click();

        console.log("✅ AI Agent: Click delivered.");

    } catch (err) {
        console.error("❌ AI Agent: Performance error:", err);
    } finally {
        if (IS_TOP_FRAME && overlay) {
            overlay.style.display = oldDisplay;
        }
    }
}

// CSS Animation and Cursor Fix
if (IS_TOP_FRAME) {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes ripple-out {
            0% { transform: scale(0.5); opacity: 1; }
            100% { transform: scale(2); opacity: 0; }
        }
        .poker-targeting-mode * {
            cursor: crosshair !important;
        }
    `;
    document.head.appendChild(style);
}
