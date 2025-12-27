// AI Agent Player - Dashboard Script

document.addEventListener('DOMContentLoaded', () => {
    const historyBody = document.getElementById('history-body');
    const noData = document.getElementById('no-data');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');

    // Stats Elements
    const statTotal = document.getElementById('stat-total');
    const statProfit = document.getElementById('stat-profit');
    const statStack = document.getElementById('stat-stack');
    const statVPIP = document.getElementById('stat-VPIP');

    function loadHistory() {
        chrome.storage.local.get(['pokeragent_history'], (result) => {
            const history = result.pokeragent_history || [];

            if (history.length === 0) {
                if (historyBody.parentElement) historyBody.parentElement.style.display = 'none';
                noData.style.display = 'block';
                updateStats([]);
                return;
            }

            noData.style.display = 'none';
            if (historyBody.parentElement) historyBody.parentElement.style.display = 'table';

            historyBody.innerHTML = history.slice(0, 50).map(item => `
                <tr>
                    <td style="color: #64748b">${new Date(item.timestamp).toLocaleTimeString()}</td>
                    <td style="font-weight: 600; font-family: monospace;">${item.hero_cards}</td>
                    <td style="font-size: 11px; color: #94a3b8">${item.board || '-'}</td>
                    <td>
                        <div style="font-weight: bold">$${item.pot_size || 0}</div>
                        <div style="font-size: 10px; color: #64748b">Stack: $${item.hero_stack || '-'}</div>
                    </td>
                    <td><span class="action-tag action-${item.action}">${item.action}</span></td>
                    <td style="font-size: 11px; color: #94a3b8; max-width: 400px;">
                        <strong>MDF:</strong> ${item.mdf || '-'}<br>
                        <strong>GTO Logic:</strong> ${item.gto_logic || '-'}<br>
                        <strong>Range:</strong> ${item.range_type || '-'}
                    </td>
                </tr>
            `).join('');

            updateStats(history);
        });
    }

    function updateStats(history) {
        if (history.length === 0) {
            statTotal.innerText = '0';
            statProfit.innerText = '$0';
            statStack.innerText = '$0';
            statVPIP.innerText = '0%';
            return;
        }

        const total = history.length;
        const currentStack = history[0].hero_stack || 0;
        const initialStack = history[history.length - 1].hero_stack || currentStack;
        const profit = (currentStack - initialStack).toFixed(2);

        const folds = history.filter(h => h.action === 'FOLD').length;
        const played = total - folds;
        const vpip = Math.round((played / total) * 100);

        statTotal.innerText = total;
        statStack.innerText = `$${currentStack}`;
        statProfit.innerText = (profit >= 0 ? '+' : '') + `$${profit}`;
        statProfit.style.color = profit >= 0 ? '#4ade80' : '#f87171';
        statVPIP.innerText = `${vpip}%`;
    }

    // Export to CSV
    exportBtn.addEventListener('click', () => {
        chrome.storage.local.get(['pokeragent_history'], (result) => {
            const history = result.pokeragent_history || [];
            if (history.length === 0) return;

            const headers = ['Timestamp', 'Cards', 'Board', 'Pot', 'Action', 'Reasoning'];
            const rows = history.map(h => [
                h.timestamp,
                h.hero_cards,
                h.board,
                h.pot_size,
                h.action,
                `"${h.reasoning.replace(/"/g, '""')}"`
            ]);

            const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `poker_ai_history_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    });

    // Clear History
    clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all history?')) {
            chrome.storage.local.remove(['pokeragent_history'], () => {
                loadHistory();
            });
        }
    });

    loadHistory();
    // Refresh occasionally
    setInterval(loadHistory, 5000);
});
