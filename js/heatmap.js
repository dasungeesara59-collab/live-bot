/**
 * 📈 BOOKMAP PRO ENGINE V13.0 — PRECISION WALL
 * 100% Aesthetic Replica with Advanced Liquidity Noise Filtering
 */

let heatmapActive = false;
let heatmapPair = '';
let depthWS = null;
let tradeWS = null;

// Core Data Buffers
let heatSnapshots = [];
let tradeBubbles = [];
let cvdData = [];
let deepDOMData = { bids: [], asks: [] }; // 1000 level depth buffer
const MAX_SNAPSHOTS = 100000;
const MAX_BUBBLES = 200000; // Increased to hold more history
const MAX_CVD = 100000;
let klines = []; // { time, open, high, low, close }
const MAX_KLINES = 5000;      // Increased for history

// 🧱 Absorption Zones (fetched from bot API)
let absorptionZones = []; // { price, side, strength, ageSeconds }
let absorptionZonePollInterval = null;

// 🏆 Global Liquidity Aggregation
let globalClusters = [];
let globalRawDepth = []; // Array of { id, bids, asks }
let globalLiquidityPollInterval = null;

let isProMode = false;
let dashboardResizeObserver = null;
let deepDepthInterval = null;

async function pollGlobalLiquidity() {
    if (!heatmapActive || !heatmapPair) return;
    try {
        const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        const res = await fetch(`${base}/api/bot/liquidity/global-dom?pair=${heatmapPair}`);
        const data = await res.json();
        if (data.success && data.data) {
            if (data.data.clusters) globalClusters = data.data.clusters;
            if (data.data.rawResults) globalRawDepth = data.data.rawResults;
        }
    } catch (e) { /* non-critical */ }
}

async function pollAbsorptionZones() {
    if (!heatmapActive || !heatmapPair) return;
    try {
        const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        const res = await fetch(`${base}/api/bot/absorption-zones`);
        const data = await res.json();
        if (data.success && data.zones) {
            const pairZones = data.zones[heatmapPair] || [];
            absorptionZones = pairZones;
        }
    } catch (e) { /* non-critical */ }
}


// ⏳ Settings & State
let TIME_WINDOW_MS = parseInt(localStorage.getItem('heatmapDefaultTF')) || 120000;
let currentCVD = 0;
let tradeCounter = 0;
let lastTPSUpdate = Date.now();
let currentTPS = 0;
let bubbleScale = parseFloat(localStorage.getItem('heatmapBubbleScale')) || 1.0;
let heatSensitivity = parseFloat(localStorage.getItem('heatmapHeatSensitivity')) || 0.3;
let domAggregation = parseFloat(localStorage.getItem('heatmapDomAgg')) || 0;
let whaleSizeMultiplier = parseFloat(localStorage.getItem('heatmapWhaleSize')) || 1.0;

// 🔍 Interaction & View State
let minPrice = 0;
let maxPrice = 0;
let currentPrice = 0;
let isDragging = false;
let isRightDragging = false;
let lastMouseY = 0;
let lastMouseX = 0;
let timeOffset = 0; // ms offset from "now"
let isLive = true;
let tickSize = 1.0; // Global standardized tick size

// Rendering State
let lastRenderTime = 0;
let lastDOMData = { bids: [], asks: [] };
let domHeatHits = {}; // Real-time trade hits for DOM sidebar: { price: { qty, time } }
let hoveredBubble = null; // { x, y, radius, buyQty, sellQty, price, time }
let domDelta = {}; // Live DOM Sync: { price: deltaSum }

// 🔊 AUDIO ENGINE
let isMuted = localStorage.getItem('heatmapMuted') === 'true';
let audioCtx = null;

async function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
}

// 🔊 Add Window-level click to unlock audio
window.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}, { once: true });

function playSynthSound(frequency, type, duration, volume = 0.1) {
    if (isMuted || !audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type; // 'sine', 'square', 'sawtooth', 'triangle'
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) { console.warn('Audio play failed:', e); }
}

function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('heatmapMuted', isMuted);
    const btn = document.getElementById('muteBtn');
    if (btn) {
        btn.innerHTML = isMuted ? '🔇' : '🔊';
        btn.style.opacity = isMuted ? '0.4' : '0.8';
    }
    if (!isMuted) initAudio();
}

// Export for other scripts if needed
window.triggerSignalSound = () => {
    if (document.getElementById('signalSound')?.checked) {
        // High-pitched chime for signals
        initAudio().then(() => {
            playSynthSound(880, 'sine', 0.5, 0.15);
            setTimeout(() => playSynthSound(1320, 'sine', 0.8, 0.1), 150);
        });
    }
};

window.testAudio = (type) => {
    initAudio().then(() => {
        if (type === 'whale') {
            playSynthSound(150, 'triangle', 0.5, 0.2);
        } else {
            playSynthSound(880, 'sine', 0.5, 0.15);
            setTimeout(() => playSynthSound(1320, 'sine', 0.8, 0.1), 150);
        }
    });
};

// 🎨 ATAS "Hot-Map" Vivid Palette — sharper contrasts for Big Orders
const HEAT_COLORS = [
    { threshold: 0.0,  color: [0,  5,  20] },   // Quiet: Deep void
    { threshold: 0.15, color: [0,  20,  80] },  // Noise floor boundary
    { threshold: 0.3,  color: [0,  80,  220] },  // Low: blue
    { threshold: 0.5,  color: [0,  220, 255] },  // Medium: cyan
    { threshold: 0.65, color: [0,  255, 150] },  // High: teal/neon
    { threshold: 0.8,  color: [255, 255, 0] },   // Pro: yellow
    { threshold: 0.9,  color: [255, 100, 0] },   // Epic: orange
    { threshold: 1.0,  color: [255, 0,   50] }    // Wall: vivid red
];

function getVividColor(intensity, alpha = 1.0) {
    if (intensity <= 0) return 'rgba(0,0,0,0)';

    // ATAS Style: Sharper transitions
    const idx = HEAT_COLORS.findIndex(c => c.threshold >= intensity);
    if (idx <= -1) {
        const c = HEAT_COLORS[HEAT_COLORS.length - 1].color;
        return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    }
    if (idx <= 0) {
        const c = HEAT_COLORS[1].color;
        return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    }

    const lower = HEAT_COLORS[idx - 1];
    const upper = HEAT_COLORS[idx];
    const range = upper.threshold - lower.threshold;
    const factor = (intensity - lower.threshold) / range;

    const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * factor);
    const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * factor);
    const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * factor);

    return `rgba(${r},${g},${b},${alpha})`;
}

function updateBubbleScale(val) {
    bubbleScale = parseFloat(val);
    localStorage.setItem('heatmapBubbleScale', val);
}

function updateHeatSensitivity(val) {
    heatSensitivity = parseFloat(val);
    localStorage.setItem('heatmapHeatSensitivity', val);
}

function updateTimeZoom(val) {
    TIME_WINDOW_MS = parseInt(val) * 1000;
    localStorage.setItem('heatmapDefaultTF', TIME_WINDOW_MS);
    
    // Sync sliders
    const proX = document.getElementById('proZoomX');
    if (proX) proX.value = val;
    const dashX = document.getElementById('timeZoomSlider');
    if (dashX) dashX.value = val;
}

function updateDomAggregation(val) {
    domAggregation = parseFloat(val);
    localStorage.setItem('heatmapDomAgg', val);
    
    // Sync Pro Toolbar slider if it exists
    const proS = document.getElementById('proDomAgg');
    if (proS && proS.value !== val) proS.value = val;
    
    // Sync Dashboard slider if it exists
    const dashS = document.getElementById('domAggSlider');
    if (dashS && dashS.value !== val) dashS.value = val;

    if (typeof updateStandardizedTickSize === 'function') {
        updateStandardizedTickSize();
    }
}

function updateWhaleSize(val) {
    whaleSizeMultiplier = parseFloat(val);
    localStorage.setItem('heatmapWhaleSize', val);
    
    // Sync Pro Toolbar slider if it exists
    const proS = document.getElementById('proWhaleSize');
    if (proS && proS.value !== val) proS.value = val;
    
    // Sync Dashboard slider if it exists
    const dashS = document.getElementById('whaleSizeSlider');
    if (dashS && dashS.value !== val) dashS.value = val;
}

function setTimeframe(ms) {
    TIME_WINDOW_MS = ms;
    localStorage.setItem('heatmapDefaultTF', ms);
    document.querySelectorAll('.tf-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'none';
        b.style.color = '#888';
    });
    // Update both dashboard and pro toolbar buttons
    const btns = document.querySelectorAll(`.tf-btn[onclick="setTimeframe(${ms})"]`);
    btns.forEach(b => {
        b.classList.add('active');
        b.style.background = '#3b82f6';
        b.style.color = '#fff';
    });
    // Fetch more history for larger timeframes
    const tradeLimit = ms >= 900000 ? 5000 : 1000;
    loadTradeHistory(heatmapPair, tradeLimit);
}

function toggleProMode() {
    isProMode = !isProMode;
    const modal = document.getElementById('heatmapModal');
    const dashboard = document.querySelector('.main-content');

    if (isProMode) {
        modal.classList.add('pro-mode');
        // Copy timeframe buttons to pro toolbar
        const tfGroup = document.getElementById('proTfGroup');
        const originalTfs = document.querySelector('.tf-btn').parentNode.innerHTML;
        tfGroup.innerHTML = originalTfs;

        // Sync sliders
        document.getElementById('proHeat').value = heatSensitivity;
        const proX = document.getElementById('proZoomX');
        if (proX) proX.value = TIME_WINDOW_MS / 1000;
        const proW = document.getElementById('proWhaleSize');
        if (proW) proW.value = whaleSizeMultiplier;
    } else {
        modal.classList.remove('pro-mode');
    }

    // Force immediate resize
    handleResize();
}

function handleResize() {
    const canvases = ['heatmapCanvas', 'domCanvas'];
    let allSized = true;
    canvases.forEach(id => {
        const c = document.getElementById(id);
        const container = c ? c.parentElement : null;
        if (c && container) {
            // Try offsetWidth first (CSS layout), then clientWidth
            const w = container.offsetWidth || container.clientWidth;
            const h = container.offsetHeight || container.clientHeight;

            if (w < 10 || h < 10) {
                allSized = false;
                return;
            }

            const dpr = window.devicePixelRatio || 1;
            c.width = w * dpr;
            c.height = h * dpr;
            const ctx = c.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            console.log(`[Heatmap] ✅ Sized ${id}: ${w}x${h}`);
        }
    });
    return allSized;
}

function ensureCanvasSized() {
    // Retry every 100ms until canvas has real dimensions (max 30 tries = 3 seconds)
    let tries = 0;
    const tryResize = () => {
        if (!heatmapActive) return;
        const done = handleResize();
        if (!done && tries < 30) {
            tries++;
            setTimeout(tryResize, 100);
        }
    };
    tryResize();
}

window.addEventListener('resize', handleResize);

function closeWebSockets() {
    if (depthWS) {
        try { depthWS.close(); } catch (e) {}
        depthWS = null;
    }
    if (tradeWS) {
        try { tradeWS.close(); } catch (e) {}
        tradeWS = null;
    }
}

async function openHeatmap(pair) {
    if (!pair) return;
    
    // 1. Cleanup existing resources
    heatmapActive = false; // Stop loops
    closeWebSockets();
    if (deepDepthInterval) clearInterval(deepDepthInterval);
    if (absorptionZonePollInterval) clearInterval(absorptionZonePollInterval);
    if (globalLiquidityPollInterval) clearInterval(globalLiquidityPollInterval);
    
    // 2. Reset state for new pair
    heatmapPair = pair; 
    heatmapActive = true; 
    heatSnapshots = []; 
    tradeBubbles = []; 
    cvdData = []; 
    currentCVD = 0;
    minPrice = 0; // Reset price axis
    maxPrice = 0; // Reset price axis
    currentPrice = 0;
    
    document.getElementById('heatmapModal').style.display = 'block';
    const pairBadge = document.getElementById('heatmapPairBadge');
    if (pairBadge) {
        if (pairBadge.tagName === 'INPUT') pairBadge.value = pair;
        else pairBadge.innerText = pair;
    }

    // Ensure canvas has correct dimensions with retry mechanism
    ensureCanvasSized();
    setTimeout(handleResize, 200);
    setTimeout(handleResize, 500);
    setTimeout(handleResize, 1000);

    const dashboard = document.getElementById('heatmapDashboard');
    if (dashboard) {
        if (dashboardResizeObserver) dashboardResizeObserver.disconnect();
        dashboardResizeObserver = new ResizeObserver(() => handleResize());
        dashboardResizeObserver.observe(dashboard);
    }

    // Sync UI Sliders
    document.querySelectorAll('#bubbleSizeSlider, #proSize').forEach(s => s.value = bubbleScale);
    document.querySelectorAll('#heatFilterSlider, #proHeat').forEach(s => s.value = heatSensitivity);
    document.querySelectorAll('#timeZoomSlider, #proZoomX').forEach(s => s.value = TIME_WINDOW_MS / 1000);
    document.querySelectorAll('#whaleSizeSlider, #proWhaleSize').forEach(s => s.value = whaleSizeMultiplier);
    document.querySelectorAll('#domAggSlider, #proDomAgg').forEach(s => s.value = domAggregation);

    setTimeframe(TIME_WINDOW_MS);
    setupInteractions();

    // 🚀 START RENDERLOOP IMMEDIATELY so canvas shows 'Connecting...' instead of black
    // Data loads below are async and can take 5-15 seconds for large history

    // 💥 FORCE canvas dimensions NOW using viewport as absolute fallback
    // This ensures the canvas is NEVER 0x0 when the render loop starts
    (function forceSizeCanvases() {
        const dpr = window.devicePixelRatio || 1;
        const dashboard = document.getElementById('heatmapDashboard');
        const dashW = dashboard ? (dashboard.offsetWidth || dashboard.clientWidth) : 0;
        const dashH = dashboard ? (dashboard.offsetHeight || dashboard.clientHeight || 600) : 600;

        const heatCanvas = document.getElementById('heatmapCanvas');
        if (heatCanvas) {
            const parentW = (heatCanvas.parentElement && heatCanvas.parentElement.offsetWidth) || (dashW - 185) || (window.innerWidth * 0.88);
            const parentH = (heatCanvas.parentElement && heatCanvas.parentElement.offsetHeight) || dashH;
            heatCanvas.width = Math.round(parentW * dpr);
            heatCanvas.height = Math.round(parentH * dpr);
            console.log(`[Heatmap] 🎯 Force-sized heatmapCanvas: ${Math.round(parentW)}x${Math.round(parentH)}`);
        }

        const domCanvas = document.getElementById('domCanvas');
        if (domCanvas) {
            const domParentW = (domCanvas.parentElement && domCanvas.parentElement.offsetWidth) || 180;
            const domParentH = (domCanvas.parentElement && domCanvas.parentElement.offsetHeight) || dashH;
            domCanvas.width = Math.round(domParentW * dpr);
            domCanvas.height = Math.round(domParentH * dpr);
            console.log(`[Heatmap] 🎯 Force-sized domCanvas: ${Math.round(domParentW)}x${Math.round(domParentH)}`);
        }
    })();

    requestAnimationFrame(renderLoop);
    startWebSockets(pair); // Start live data ASAP

    // Load historical data in background (doesn't block render)
    loadInitialHistory(pair).catch(e => console.error('[Heatmap] History err:', e));
    fetchKlines(pair).catch(e => console.error('[Heatmap] Klines err:', e));
    loadTradeHistory(pair, 10000).catch(e => console.error('[Heatmap] Trade history err:', e));

    // 🧱 Start absorption zone polling every 5s
    absorptionZones = [];
    pollAbsorptionZones();
    if (absorptionZonePollInterval) clearInterval(absorptionZonePollInterval);
    absorptionZonePollInterval = setInterval(pollAbsorptionZones, 5000);

    // 🏆 Start global liquidity polling every 10s
    globalClusters = [];
    pollGlobalLiquidity();
    if (globalLiquidityPollInterval) clearInterval(globalLiquidityPollInterval);
    globalLiquidityPollInterval = setInterval(pollGlobalLiquidity, 10000);

    // 🌊 Deep Depth REST polling every 15s — balanced density vs performance
    refreshDeepDepth(pair);
    if (deepDepthInterval) clearInterval(deepDepthInterval);
    deepDepthInterval = setInterval(() => refreshDeepDepth(pair), 15000);
}

async function refreshDeepDepth(pair) {
    if (!heatmapActive || !pair) return;
    try {
        const symbol = pair.replace('/', '').toUpperCase();
        
        let data = null;
        // Always try to fetch directly from Binance API first (works on GitHub Pages and local files)
        try {
            const bRes = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`);
            if (bRes.ok) data = await bRes.json();
        } catch (e) {
            console.warn("[Heatmap] Direct Binance fetch failed, trying local proxy...");
        }

        // Fallback to local bot API if direct fetch fails (CORS or other reasons)
        if (!data) {
            const isStandalone = window.location.protocol === 'file:' || window.location.hostname.includes('github.io');
            const base = isStandalone ? 'http://localhost:3000' : '';
            const res = await fetch(`${base}/api/liquidity/proxy-depth/${symbol}`);
            if (res.ok) data = await res.json();
        }

        if (data && data.bids) {
            const allBids = data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]);
            const allAsks = data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]);

            // 🎯 FOR HEATMAP: Keep TOP 50 levels for background noise reduction
            const topBids = [...allBids].sort((a, b) => b[1] - a[1]).slice(0, 50);
            const topAsks = [...allAsks].sort((a, b) => b[1] - a[1]).slice(0, 50);

            // 🎯 FOR DOM: Keep FULL depth so we see the spread around current price
            deepDOMData = { bids: allBids, asks: allAsks };

            // 🌊 DEEP HEAT INJECTION (Noise filtered for chart background)
            heatSnapshots.push({
                time: Date.now(),
                price: currentPrice || parseFloat(data.bids[0][0]),
                bids: topBids,
                asks: topAsks,
                isDeep: true
            });
            if (heatSnapshots.length > MAX_SNAPSHOTS) heatSnapshots.shift();

            console.log(`[Heatmap] ✅ Deep Depth Synced: Raw ${allBids.length + allAsks.length}L | Filtered ${topBids.length + topAsks.length}L for ${symbol}`);
        }
    } catch (e) { console.error('[Heatmap] ❌ Deep Depth Err:', e); }
}

function setupInteractions() {
    const canvas = document.getElementById('heatmapCanvas');
    if (!canvas) return; // Safety guard

    canvas.onwheel = (e) => {
        e.preventDefault();
        document.getElementById('autoScale') && (document.getElementById('autoScale').checked = false);

        // Zoom Logic: Zoom into price at cursor
        const rect = canvas.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const mousePrice = maxPrice - (mouseY / canvas.offsetHeight) * (maxPrice - minPrice);

        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const newRange = (maxPrice - minPrice) * zoomFactor;

        // Maintain relative distance of price to cursor
        const ratio = mouseY / canvas.offsetHeight;
        maxPrice = mousePrice + ratio * newRange;
        minPrice = maxPrice - newRange;
    };

    canvas.onmousedown = (e) => {
        if (e.button === 0) { // Left Click
            isDragging = true;
            lastMouseY = e.clientY;
            lastMouseX = e.clientX;
            canvas.style.cursor = 'grabbing';
        } else if (e.button === 2) { // Right Click
            isRightDragging = true;
            lastMouseX = e.clientX;
            canvas.style.cursor = 'ew-resize';
            e.preventDefault();
        }
    };

    canvas.oncontextmenu = (e) => e.preventDefault(); // Disable context menu for right-drag

    window.onmousemove = (e) => {
        if (!heatmapActive) return;

        if (isDragging) {
            document.getElementById('autoScale') && (document.getElementById('autoScale').checked = false);
            const deltaY = e.clientY - lastMouseY;
            const deltaX = e.clientX - lastMouseX;
            const pricePerPixel = (maxPrice - minPrice) / canvas.offsetHeight;

            minPrice += deltaY * pricePerPixel;
            maxPrice += deltaY * pricePerPixel;

            // Optional: Left click drag for time too? User asked for scrolling.
            // Let's use right-drag for time to keep them separate, or Shift+Drag
            if (e.shiftKey) {
                isLive = false;
                const timePerPixel = TIME_WINDOW_MS / canvas.offsetWidth;
                timeOffset += deltaX * timePerPixel;
            }

            lastMouseY = e.clientY;
            lastMouseX = e.clientX;
        }

        if (isRightDragging) {
            isLive = false;
            const deltaX = e.clientX - lastMouseX;
            const timePerPixel = TIME_WINDOW_MS / canvas.offsetWidth;
            timeOffset += deltaX * timePerPixel;
            lastMouseX = e.clientX;
        }

        // TOOLTIP HIT DETECTION
        if (!isDragging && !isRightDragging) {
            const rect = canvas.getBoundingClientRect();
            lastMouseX = e.clientX - rect.left;
            lastMouseY = e.clientY - rect.top;
            
            // We'll calculate the hit in the next render frame for performance
            // or just use a small delay hit-test
        }
    };

    window.onmouseup = () => {
        isDragging = false;
        isRightDragging = false;
        canvas.style.cursor = 'crosshair';
    };

    canvas.ondblclick = () => {
        isLive = true;
        timeOffset = 0;
        document.getElementById('autoScale') && (document.getElementById('autoScale').checked = true);
    };

    // 📱 MOBILE TOUCH SUPPORT
    let initialTouchDistance = 0;
    
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDragging = true;
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialTouchDistance = Math.sqrt(dx * dx + dy * dy);
        }
        // Prevent default browser behavior (scrolling, zooming)
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (!heatmapActive) return;

        if (e.touches.length === 1 && isDragging) {
            document.getElementById('autoScale') && (document.getElementById('autoScale').checked = false);
            
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;

            const deltaY = clientY - lastMouseY;
            const deltaX = clientX - lastMouseX;
            
            // Pan Y (Price)
            const pricePerPixel = (maxPrice - minPrice) / canvas.offsetHeight;
            minPrice += deltaY * pricePerPixel;
            maxPrice += deltaY * pricePerPixel;

            // Pan X (Time) - Allows free scrolling on mobile
            isLive = false;
            const timePerPixel = TIME_WINDOW_MS / canvas.offsetWidth;
            timeOffset += deltaX * timePerPixel;

            lastMouseX = clientX;
            lastMouseY = clientY;
            
        } else if (e.touches.length === 2 && initialTouchDistance > 0) {
            // Pinch to zoom Y axis
            document.getElementById('autoScale') && (document.getElementById('autoScale').checked = false);
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 0) {
                // Determine zoom factor
                const zoomFactor = initialTouchDistance / distance;
                const newRange = (maxPrice - minPrice) * zoomFactor;

                // Zoom around center for touch
                const centerPrice = (maxPrice + minPrice) / 2;
                maxPrice = centerPrice + newRange / 2;
                minPrice = centerPrice - newRange / 2;
            }
            initialTouchDistance = distance;
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            isDragging = false;
        } else if (e.touches.length === 1) {
            // Re-anchor single dragging touch
            isDragging = true;
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
        }
    });

}

function closeHeatmap() {
    heatmapActive = false;
    document.getElementById('heatmapModal').style.display = 'none';
    if (depthWS) depthWS.close();
    if (tradeWS) tradeWS.close();
    if (absorptionZonePollInterval) { clearInterval(absorptionZonePollInterval); absorptionZonePollInterval = null; }
    if (globalLiquidityPollInterval) { clearInterval(globalLiquidityPollInterval); globalLiquidityPollInterval = null; }
    if (deepDepthInterval) { clearInterval(deepDepthInterval); deepDepthInterval = null; }
    absorptionZones = [];
    globalClusters = [];
}

async function loadInitialHistory(pair) {
    try {
        const pairParam = pair.replace('/', '-');
        const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        const res = await fetch(`${base}/api/liquidity/history/${pairParam}`);
        const data = await res.json();
        if (data.success) {
            heatSnapshots = data.snapshots.map(s => ({
                time: new Date(s.timestamp).getTime(),
                price: s.price,
                bids: (s.bids || []).map(b => [parseFloat(b[0]), parseFloat(b[1])]),
                asks: (s.asks || []).map(a => [parseFloat(a[0]), parseFloat(a[1])])
            }));
            if (heatSnapshots.length > 0) {
            if (heatSnapshots.length > 0) {
                currentPrice = heatSnapshots[heatSnapshots.length - 1].price;
                if (!minPrice || minPrice === 0) {
                    // ATAS SMART ZOOM: Start with ±0.5% window for context
                    minPrice = currentPrice * 0.995;
                    maxPrice = currentPrice * 1.005;
                }
            }
            }
        }
    } catch (e) { console.error('History API error:', e); }
}

async function fetchKlines(pair) {
    try {
        const symbol = pair.replace('/', '').toUpperCase();
        // Fetch up to 1000 1m klines for larger timeframe context
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1000`);
        const data = await res.json();
        klines = data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            delta: 0 // Initialize delta
        }));
        console.log(`📊 Loaded ${klines.length} klines for ${symbol}`);
    } catch (e) {
        console.error('Klines fetch error:', e);
    }
}

async function loadTradeHistory(pair, limit = 1000) {
    try {
        const symbol = pair.replace('/', '').toUpperCase();
        let allTrades = [];
        let endTime = Date.now();

        // Fetch in chunks of 1000 (Binance limit)
        const fetchLimit = 1000;
        const totalToFetch = Math.min(limit, 5000); // Caps at 5000 for performance

        for (let i = 0; i < Math.ceil(totalToFetch / fetchLimit); i++) {
            let url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=${fetchLimit}&endTime=${endTime}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;

            allTrades = [...data, ...allTrades];
            // Update endTime to the oldest trade in this batch to fetch previous trades
            endTime = data[0].T - 1;
            if (allTrades.length >= totalToFetch) break;
        }

        let aggregated = []; currentCVD = 0; cvdData = [];
        allTrades.forEach(t => {
            currentCVD += t.m ? -parseFloat(t.q) : parseFloat(t.q);
            cvdData.push({ time: t.T, value: currentCVD });
            const timeBin = Math.floor(t.T / 100) * 100;
            const last = aggregated[aggregated.length - 1];
            if (last && last.time === timeBin) {
                if (t.m) last.sellQty += parseFloat(t.q); else last.buyQty += parseFloat(t.q);
                last.price = (last.price + parseFloat(t.p)) / 2;
            } else {
                aggregated.push({ time: timeBin, price: parseFloat(t.p), buyQty: t.m ? 0 : parseFloat(t.q), sellQty: t.m ? parseFloat(t.q) : 0 });
            }
        });

        // Merge with existing tradeBubbles to keep history when zooming
        const existingMap = new Map(tradeBubbles.map(b => [b.time, b]));
        aggregated.forEach(b => {
            existingMap.set(b.time, b);
        });

        tradeBubbles = Array.from(existingMap.values()).sort((a, b) => a.time - b.time);
        if (tradeBubbles.length > MAX_BUBBLES) tradeBubbles = tradeBubbles.slice(-MAX_BUBBLES);

        // Pre-calculate candle deltas
        calculateCandleDeltas();

    } catch (e) { console.error('Trade history error:', e); }
}

function calculateCandleDeltas() {
    if (klines.length === 0 || tradeBubbles.length === 0) return;

    let tradeIdx = 0;
    klines.forEach(k => {
        const startTime = k.time;
        const endTime = k.time + 60000;
        k.delta = 0;
        
        // Fast-forward to start
        while (tradeIdx < tradeBubbles.length && tradeBubbles[tradeIdx].time < startTime) {
            tradeIdx++;
        }
        
        // Sum within window
        let i = tradeIdx;
        while (i < tradeBubbles.length && tradeBubbles[i].time < endTime) {
            k.delta += (tradeBubbles[i].buyQty - tradeBubbles[i].sellQty);
            i++;
        }
    });
}

function drawTooltip(ctx, b) {
    const isBTC = heatmapPair.includes('BTC');
    const unit = heatmapPair.split('/')[0];
    const buyTxt = b.buyQty >= 1000 ? (b.buyQty / 1000).toFixed(1) + 'k' : b.buyQty.toFixed(1);
    const sellTxt = b.sellQty >= 1000 ? (b.sellQty / 1000).toFixed(1) + 'k' : b.sellQty.toFixed(1);
    const totalTxt = b.totalQty >= 1000 ? (b.totalQty / 1000).toFixed(1) + 'k' : b.totalQty.toFixed(1);
    
    ctx.save();
    ctx.font = 'bold 11px Inter';
    const padding = 12;
    const lines = [
        { label: 'PRICE:', val: b.price.toFixed(isBTC ? 2 : 4) + ' ' + (heatmapPair.split('/')[1] || 'USDT'), color: '#fff' },
        { label: 'TOTAL:', val: totalTxt + ' ' + unit, color: '#facc15' },
        { label: 'BUY:', val: buyTxt + ' ' + unit, color: '#00ffcc' },
        { label: 'SELL:', val: sellTxt + ' ' + unit, color: '#ff4444' }
    ];

    const w = 150;
    const h = lines.length * 18 + padding * 2;
    
    // Position tooltip near cursor but keep on screen
    let tx = b.x + 15;
    let ty = b.y - h / 2;
    
    if (tx + w > ctx.canvas.width / (window.devicePixelRatio || 1)) tx = b.x - w - 15;
    if (ty < 10) ty = 10;
    if (ty + h > ctx.canvas.height / (window.devicePixelRatio || 1)) ty = ctx.canvas.height / (window.devicePixelRatio || 1) - h - 10;

    // Glassmorphism Box
    ctx.fillStyle = 'rgba(10, 15, 25, 0.95)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    
    ctx.beginPath();
    ctx.roundRect(tx, ty, w, h, 8);
    ctx.fill();
    ctx.stroke();
    
    ctx.shadowBlur = 0;

    // Content
    lines.forEach((line, i) => {
        const ly = ty + padding + (i * 18) + 9;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '9px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(line.label, tx + padding, ly);
        
        ctx.fillStyle = line.color;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(line.val, tx + w - padding, ly);
    });

    ctx.restore();
}

function startWebSockets(pair) {
    const symbol = pair.replace('/', '').toLowerCase();
    const wsUrl = `wss://fstream.binance.com/ws/${symbol}@depth50@100ms`;
    console.log(`[Heatmap] 🔌 Connecting Depth WS: ${wsUrl}`);
    depthWS = new WebSocket(wsUrl);
    
    depthWS.onopen = () => console.log(`[Heatmap] ✅ Depth WS Connected`);
    depthWS.onerror = (e) => console.error(`[Heatmap] ❌ Depth WS Error:`, e);

    depthWS.onmessage = (event) => {
        if (!heatmapActive) return;
        const data = JSON.parse(event.data);
        heatSnapshots.push({
            time: Date.now(), price: currentPrice || parseFloat(data.b[0][0]),
            bids: data.b.map(b => [parseFloat(b[0]), parseFloat(b[1])]), asks: data.a.map(a => [parseFloat(a[0]), parseFloat(a[1])])
        });
        lastDOMData = { bids: data.b.map(b => [parseFloat(b[0]), parseFloat(b[1])]), asks: data.a.map(a => [parseFloat(a[0]), parseFloat(a[1])]) };
        
        // 💫 SYNC: Clear live trade delta buffer when a fresh book snapshot arrives
        domDelta = {}; 

        if (heatSnapshots.length > MAX_SNAPSHOTS) heatSnapshots.shift();
    };

    const tradeWsUrl = `wss://fstream.binance.com/ws/${symbol}@aggTrade`;
    console.log(`[Heatmap] 🔌 Connecting Trade WS: ${tradeWsUrl}`);
    tradeWS = new WebSocket(tradeWsUrl);
    
    tradeWS.onopen = () => console.log(`[Heatmap] ✅ Trade WS Connected`);
    tradeWS.onerror = (e) => console.error(`[Heatmap] ❌ Trade WS Error:`, e);

    tradeWS.onmessage = (event) => {
        if (!heatmapActive) return;
        const data = JSON.parse(event.data); 
        currentPrice = parseFloat(data.p);
        const delta = data.m ? -parseFloat(data.q) : parseFloat(data.q);
        const qty = parseFloat(data.q);

        // ⚡ ATAS LIVE DOM SYNC: Apply trade impact immediately to a local buffer
        // This ensures the DOM bar shrinks the moment price hits it
        const wallTick = tickSize || (heatmapPair.includes('BTC') ? 5 : 0.1);
        const wallPrice = Math.round(currentPrice / wallTick) * wallTick;
        domDelta[wallPrice] = (domDelta[wallPrice] || 0) + qty;

        // 🐋 WHALE SOUND TRIGGER
        if (document.getElementById('whaleSound')?.checked && qty * currentPrice > 10000) { // $10k+ trade
            initAudio();
            playSynthSound(150, 'triangle', 0.3, 0.1); // Deep thump for big trades
        }

        currentCVD += delta; cvdData.push({ time: Date.now(), value: currentCVD });
        tradeCounter++; if (cvdData.length > MAX_CVD) cvdData.shift();
        const timeBin = Math.floor(Date.now() / 100) * 100;
        const last = tradeBubbles[tradeBubbles.length - 1];
        if (last && last.time === timeBin) {
            if (data.m) last.sellQty += parseFloat(data.q); else last.buyQty += parseFloat(data.q);
            last.price = (last.price + currentPrice) / 2;
        } else {
            tradeBubbles.push({ time: timeBin, price: currentPrice, buyQty: data.m ? 0 : parseFloat(data.q), sellQty: data.m ? parseFloat(data.q) : 0 });
        }
        if (tradeBubbles.length > MAX_BUBBLES) tradeBubbles.shift();

        // ⚡ REAL-TIME DOM HIT (Sidebar Pulse)
        const hitTick = heatmapPair.includes('BTC') ? (maxPrice - minPrice > 500 ? 10 : 5) : 1.0; 
        const hitBin = Math.round(currentPrice / hitTick) * hitTick;
        if (!domHeatHits[hitBin]) domHeatHits[hitBin] = { qty: 0, time: 0 };
        domHeatHits[hitBin].qty += qty;
        domHeatHits[hitBin].time = Date.now();

        // 🕯️ LIVE CANDLE LOGIC (OHLC Management)
        const candleTime = Math.floor(Date.now() / 60000) * 60000;
        let lastCandle = klines[klines.length - 1];
        if (!lastCandle || lastCandle.time !== candleTime) {
            klines.push({
                time: candleTime,
                open: currentPrice,
                high: currentPrice,
                low: currentPrice,
                close: currentPrice,
                delta: delta // Start new candle with current trade delta
            });
            if (klines.length > MAX_KLINES) klines.shift();
        } else {
            lastCandle.high = Math.max(lastCandle.high, currentPrice);
            lastCandle.low = Math.min(lastCandle.low, currentPrice);
            lastCandle.close = currentPrice;
            lastCandle.delta += delta; // Accumulate delta
        }
    };

    setInterval(() => {
        if (!heatmapActive) return;
        const now = Date.now(); currentTPS = (tradeCounter / (now - lastTPSUpdate)) * 1000;
        tradeCounter = 0; lastTPSUpdate = now;
        
        // Cleanup old DOM hits
        Object.keys(domHeatHits).forEach(k => {
            if (domHeatHits[k].time < now - 2000) delete domHeatHits[k];
        });
    }, 1000);
}

const binarySearchIndex = (arr, target, key = 'time') => {
    let low = 0, high = arr.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (arr[mid][key] < target) low = mid + 1;
        else if (arr[mid][key] > target) high = mid - 1;
        else return mid;
    }
    return low;
};

function updateStandardizedTickSize() {
    if (!currentPrice || currentPrice === 0) return;
    const isBTC = heatmapPair.includes('BTC');
    const priceRange = maxPrice - minPrice;
    if (priceRange <= 0) return;

    if (isBTC) {
        // 🧱 BTC Logic: Keep it aggregated enough to be readable without massive zoom
        if (priceRange > 500) tickSize = 10;
        else if (priceRange > 150) tickSize = 5;
        else if (priceRange > 40) tickSize = 1;
        else tickSize = 0.5;
    } else {
        // 🎯 SMART TARGET: Aim for ~120 rows for balanced density (ATAS style)
        let rawTick = priceRange / 120;
        
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawTick)));
        const normalized = rawTick / magnitude;
        
        let baseTick;
        if (normalized < 1.2) baseTick = 1;
        else if (normalized < 2.2) baseTick = 2;
        else if (normalized < 4.0) baseTick = 2.5;
        else if (normalized < 7.5) baseTick = 5;
        else baseTick = 10;
        
        tickSize = baseTick * magnitude;

        // Hard clamp for sub-dollar coins
        if (currentPrice < 2) {
            tickSize = Math.max(tickSize, 0.0001);
        } else {
            tickSize = Math.max(tickSize, 0.001);
        }
    }

    // ⭐ APPLY MANUAL DOM AGGREGATION OVERRIDE ⭐
    if (domAggregation !== 0) {
        const multipliers = [1, 2, 5, 10, 20];
        const dividers = [1, 2, 5, 10, 20];
        if (domAggregation > 0) {
            tickSize *= multipliers[Math.min(multipliers.length - 1, Math.floor(domAggregation))];
        } else {
            tickSize /= dividers[Math.min(dividers.length - 1, Math.floor(Math.abs(domAggregation)))];
        }
    }

    // Ensure tickSize isn't completely crazy
    tickSize = Math.max(tickSize, 0.000001);
}

function getPricePrecision(tick) {
    if (!tick || tick <= 0) return 2;
    // Calculate how many decimals are needed to distinguish values separated by 'tick'
    if (tick >= 1) return 2;
    const decimals = Math.ceil(-Math.log10(tick));
    return Math.min(Math.max(decimals, 2), 6); // Cap at 2-6 decimals
}

function renderLoop(time) {
    if (!heatmapActive) return;
    if (time - lastRenderTime > 24) { 
        updateStandardizedTickSize();
        drawMainChart(); 
        drawDOM(); 
        lastRenderTime = time; 
    }
    requestAnimationFrame(renderLoop);
}

function drawMainChart() {
    const canvas = document.getElementById('heatmapCanvas'); if (!canvas) return;

    // 🔑 Critical fix: Use backing store size, NOT offsetWidth (which can be 0 during layout)
    const dpr = window.devicePixelRatio || 1;
    let w = canvas.width / dpr;
    let h = canvas.height / dpr;

    // Auto-resize from parent if canvas was never sized
    if (w < 10 || h < 10) {
        const parent = canvas.parentElement;
        if (parent && parent.clientWidth > 10) {
            canvas.width = parent.clientWidth * dpr;
            canvas.height = parent.clientHeight * dpr;
            w = parent.clientWidth;
            h = parent.clientHeight;
        } else {
            return; // Parent is also 0, nothing we can do
        }
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#010306'; ctx.fillRect(0, 0, w, h);

    // Show loading state if no data yet
    if (heatSnapshots.length < 2 && tradeBubbles.length < 2) {
        ctx.fillStyle = '#1a2a3a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`⚡ BOOKMAP LIVE — Connecting...`, w / 2, h / 2 - 20);
        ctx.fillStyle = '#888';
        ctx.font = '12px monospace';
        ctx.fillText(`Canvas: ${Math.round(w)}×${Math.round(h)} | Snapshots: ${heatSnapshots.length} | Bubbles: ${tradeBubbles.length}`, w / 2, h / 2 + 10);
        ctx.fillText(`Price: ${currentPrice || 'Waiting...'}`, w / 2, h / 2 + 30);
        return;
    }

    // 🔑 Seed currentPrice from history data if WebSocket hasn't fired yet
    if (!currentPrice || currentPrice === 0) {
        if (tradeBubbles.length > 0) {
            currentPrice = tradeBubbles[tradeBubbles.length - 1].price;
        } else if (heatSnapshots.length > 0) {
            currentPrice = heatSnapshots[heatSnapshots.length - 1].price;
        }
    }

    if (document.getElementById('autoScale')?.checked) {
        if (currentPrice > 0) {
            // Always center on currentPrice. Use ±1% as default view window.
            let localMin = currentPrice * 0.995;
            let localMax = currentPrice * 1.005;

            // Expand range to include nearby snapshots (within 2% of price)
            const twoPercent = currentPrice * 0.02;
            const visibleSnaps = heatSnapshots.slice(-5000);
            visibleSnaps.forEach(s => {
                if (s.price > 0 && Math.abs(s.price - currentPrice) < twoPercent) {
                    localMin = Math.min(localMin, s.price);
                    localMax = Math.max(localMax, s.price);
                }
            });

            // Expand range to include recent trade bubbles (within 2% of price)  
            const visibleBubbles = tradeBubbles.slice(-500);
            visibleBubbles.forEach(b => {
                if (b.price > 0 && Math.abs(b.price - currentPrice) < twoPercent) {
                    localMin = Math.min(localMin, b.price);
                    localMax = Math.max(localMax, b.price);
                }
            });

            const range = (localMax - localMin);

            // Add 15% padding on each side for context
            minPrice = localMin - range * 0.15;
            maxPrice = localMax + range * 0.15;

            // Final safety: currentPrice MUST be inside [minPrice, maxPrice]
            if (currentPrice < minPrice) minPrice = currentPrice * 0.998;
            if (currentPrice > maxPrice) maxPrice = currentPrice * 1.002;
        }
    }

    // Safety guard: if price range is still 0 or invalid, use simple ±1% window
    if (!minPrice || !maxPrice || maxPrice <= minPrice || !currentPrice) {
        if (currentPrice > 0) {
            minPrice = currentPrice * 0.990;
            maxPrice = currentPrice * 1.010;
        } else {
            ctx.fillStyle = '#ff6b35';
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(`Waiting for price data...`, w / 2, h / 2);
            return;
        }
    }

    // 🕰️ TIME SYNC CHECK (Server snapshots might be slightly off from browser clock)
    if (heatSnapshots.length > 0 && isLive) {
        const lastSnapTime = heatSnapshots[heatSnapshots.length - 1].time;
        const timeDiff = Date.now() - lastSnapTime;
        // If history is way behind or ahead (e.g. > 10m), we need to align the window
        if (Math.abs(timeDiff) > 600000) {
            console.warn(`[Heatmap] 🕰️ Time desync detected (${Math.round(timeDiff/1000)}s). Aligning...`);
        }
    }

    const now = Date.now();
    const currentEnd = isLive ? now : (now + timeOffset);
    const startTimeVisible = currentEnd - TIME_WINDOW_MS;

    // Sync timeOffset back to 0 if "Live" is forced
    if (isLive) timeOffset = 0;

    const getX = (t) => ((t - startTimeVisible) / TIME_WINDOW_MS) * w;
    const getY = (p) => h - ((p - minPrice) / (maxPrice - minPrice) * h);

    const startIdx = binarySearchIndex(heatSnapshots, startTimeVisible - 5000);
    const visibleSnaps = heatSnapshots.slice(startIdx);

    // 🔬 STABILIZED NORMALIZATION — Use 90th percentile max to prevent one giant wall washing out everything
    let globalMaxQty = 1;
    const allQtys = [];
    visibleSnaps.forEach(s => {
        s.asks.forEach(l => { if (l[1] > 0) allQtys.push(l[1]); });
        s.bids.forEach(l => { if (l[1] > 0) allQtys.push(l[1]); });
    });
    if (allQtys.length > 0) {
        allQtys.sort((a, b) => a - b);
        // Use 90th percentile so extreme outliers don't dominate
        const p90idx = Math.floor(allQtys.length * 0.90);
        globalMaxQty = allQtys[p90idx] || allQtys[allQtys.length - 1] || 1;
    }

    visibleSnaps.forEach((s, idx) => {
        const x = getX(s.time); 
        if (x > w + 50) return;

        const nextSnap = visibleSnaps[idx + 1];
        const nextX = nextSnap ? getX(nextSnap.time) : w;
        const rectW = Math.max(2, nextX - x); // min 2px column width

        const levels = [...s.asks, ...s.bids];

        // 🎨 Heat slider controls visibility threshold (Aggressive Noise Floor)
        // Adjust formula so 1.0 can completely hide them (filterThreshold > 1).
        const filterThreshold = heatSensitivity >= 1.0 ? 2.0 : (0.1 + heatSensitivity * 0.8); 

        levels.forEach(l => {
            const rawIntensity = l[1] / globalMaxQty;
            // ATAS Style: Higher power (0.6 instead of 0.45) makes the gradient steeper
            // This suppresses noise and only lets the strongest "walls" shine through
            const intensity = Math.pow(Math.min(1, rawIntensity), 0.65);
            if (intensity < filterThreshold) return;

            const y = getY(l[0]);
            if (y < -20 || y > h + 20) return;

            // 💪 Thicker walls: min 3px, max 8px based on intensity
            const baseRowH = Math.max(2, Math.abs(getY(l[0]) - getY(l[0] + tickSize)));
            const wallThickness = Math.max(3, Math.min(8, baseRowH * (0.6 + intensity * 0.8)));

            // 🌟 GLOW EFFECT for strongest walls (top 20%)
            if (intensity > 0.80) {
                ctx.save();
                ctx.shadowBlur = 10;
                ctx.shadowColor = getVividColor(intensity, 1.0);
            }

            const alpha = Math.min(0.98, 0.55 + intensity * 0.43);
            ctx.fillStyle = getVividColor(intensity, alpha);
            ctx.fillRect(x, y - wallThickness / 2, rectW, wallThickness);

            if (intensity > 0.80) ctx.restore();
        });
    });

    // 📊 SHARED CALC DATA (Pre-filtered for speed)
    const bubbleStartIdx = binarySearchIndex(tradeBubbles, startTimeVisible - 600000); // Back 10m for calculations
    const calcTrades = tradeBubbles.slice(bubbleStartIdx);

    // 📊 VOLUME HISTOGRAM / VWAP (Optimized single-pass)
    const volH = h * 0.15; 
    const histBins = {};
    let maxBinVol = 0;
    let cumPV = 0; 
    let cumV = 0;
    const vwapPoints = [];
    const priceBins = {};

    calcTrades.forEach(t => {
        const x = getX(t.time);
        const q = t.buyQty + t.sellQty;
        
        // VWAP (10m lookback)
        cumPV += t.price * q;
        cumV += q;
        if (x >= 0 && x <= w) {
            vwapPoints.push({ time: t.time, value: cumPV / cumV });
            
            // Volume Histogram
            const binIdx = Math.floor(x / 6); 
            if (!histBins[binIdx]) histBins[binIdx] = { buy: 0, sell: 0 };
            histBins[binIdx].buy += t.buyQty; 
            histBins[binIdx].sell += t.sellQty;
            maxBinVol = Math.max(maxBinVol, histBins[binIdx].buy + histBins[binIdx].sell);

            // POC (Visible only)
            const pBin = Math.round(t.price * 10) / 10;
            priceBins[pBin] = (priceBins[pBin] || 0) + q;
        }
    });

    // Drawing VWAP
    if (document.getElementById('showVWAP')?.checked && vwapPoints.length > 2) {
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.beginPath();
        vwapPoints.forEach((p, i) => {
            const x = getX(p.time); const y = getY(p.value);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 10px Inter'; ctx.fillText('VWAP', 10, getY(vwapPoints[vwapPoints.length - 1].value) - 10);
    }

    // Drawing Volume Histogram
    Object.keys(histBins).forEach(binX => {
        const x = binX * 6; const data = histBins[binX]; const total = data.buy + data.sell;
        const barH = Math.min(volH, (total / maxBinVol) * volH);
        ctx.fillStyle = 'rgba(0, 255, 120, 0.7)'; ctx.fillRect(x, h - (data.buy / total) * barH, 5, (data.buy / total) * barH);
        ctx.fillStyle = 'rgba(255, 40, 40, 0.7)'; ctx.fillRect(x, h - barH, 5, (data.sell / total) * barH);
    });

    // 📊 DELTA BARS (Net Flow)
    if (document.getElementById('showDeltaBars')?.checked) {
        const deltaH = h * 0.08;
        Object.keys(histBins).forEach(binX => {
            const x = binX * 6; const data = histBins[binX]; const netDelta = data.buy - data.sell;
            const barH = Math.min(deltaH, (Math.abs(netDelta) / maxBinVol) * deltaH * 2);
            ctx.fillStyle = netDelta > 0 ? 'rgba(0, 255, 120, 0.9)' : 'rgba(255, 40, 40, 0.9)';
            const yStart = h - volH - 10;
            if (netDelta > 0) ctx.fillRect(x, yStart - barH, 5, barH);
            else ctx.fillRect(x, yStart, 5, barH);
        });
        ctx.fillStyle = '#10b981'; ctx.font = 'bold 9px Inter'; ctx.fillText('NET DELTA', 10, h - volH - 25);
    }

    // 🎯 POC (Point of Control)
    if (document.getElementById('showPOC')?.checked) {
        let maxVol = 0; let pocPrice = 0;
        Object.keys(priceBins).forEach(p => { if (priceBins[p] > maxVol) { maxVol = priceBins[p]; pocPrice = parseFloat(p); } });

        if (pocPrice > 0) {
            const y = getY(pocPrice);
            ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 2; ctx.setLineDash([10, 5]);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#8b5cf6'; ctx.font = 'bold 11px Inter'; ctx.fillText(`POC: $${pocPrice}`, w - 70, y - 5);
        }
    }

    // ⚡ IMBALANCE MARKERS
    if (document.getElementById('showImbalance')?.checked) {
        tradeBubbles.forEach(t => {
            const x = getX(t.time); if (x < 0 || x > w) return;
            const ratio = t.buyQty > t.sellQty ? t.buyQty / Math.max(0.1, t.sellQty) : t.sellQty / Math.max(0.1, t.buyQty);
            if (ratio > 4 && (t.buyQty + t.sellQty) > maxBinVol * 0.1) { // 4x Imbalance + significant volume
                const y = getY(t.price);
                ctx.fillStyle = t.buyQty > t.sellQty ? '#00ffaa' : '#ff3366';
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
                // Add mini glow
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
            }
        });
    }

    // 🔵 TRADES (ADAPTIVE BUBBLES - Optimized Culling)
    if (document.getElementById('showBubbles')?.checked) {
        const bubbleStartIdx = binarySearchIndex(tradeBubbles, startTimeVisible - 1000);
        const visibleTrades = tradeBubbles.slice(bubbleStartIdx).filter(t => getX(t.time) < w + 50);

        // Calculate dynamic average for better relative scaling
        const avgVol = visibleTrades.length > 0 ? visibleTrades.reduce((a, b) => a + (b.buyQty + b.sellQty), 0) / visibleTrades.length : 1;

        visibleTrades.sort((a, b) => (a.buyQty + a.sellQty) - (b.buyQty + b.sellQty)).forEach(t => {
            const x = getX(t.time);
            const y = getY(t.price);
            const totalQty = t.buyQty + t.sellQty;
            const delta = t.buyQty - t.sellQty;

            // 💡 FIXED SCALING: More stable radius range
            const baseFactor = Math.sqrt(totalQty / avgVol);
            let radius = baseFactor * (12 * bubbleScale);

            // Whale threshold (based on delta impact)
            const isWhale = Math.abs(delta) > (avgVol * 15) || Math.abs(delta) > 5000;

            // Apply Whale Size Multiplier if it's a whale bubble
            if (isWhale) {
                radius *= whaleSizeMultiplier;
            }

            // Clamp radius: min 1.5, max 40 (or larger for whales)
            const maxRadius = isWhale ? 40 * Math.max(1, whaleSizeMultiplier) : 40;
            radius = Math.min(maxRadius, Math.max(1.5, radius));

            ctx.save();
            ctx.globalAlpha = 0.90;

            if (isWhale) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = delta < 0 ? '#ff00ff' : '#00ffff';
            }

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.clip();

            const buyRatio = t.buyQty / totalQty;

            // Modern Vivid Gradients
            const buyGrad = ctx.createRadialGradient(x, y - radius / 2, 1, x, y, radius);
            buyGrad.addColorStop(0, isWhale && delta > 0 ? '#ccffff' : '#00ffcc');
            buyGrad.addColorStop(1, '#004455');
            ctx.fillStyle = buyGrad;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2 * buyRatio);

            const sellGrad = ctx.createRadialGradient(x, y + radius / 2, 1, x, y, radius);
            sellGrad.addColorStop(0, isWhale && delta < 0 ? '#ff00ff' : '#ff4444');
            sellGrad.addColorStop(1, '#550000');
            ctx.fillStyle = sellGrad;
            ctx.fillRect(x - radius, y - radius + (radius * 2 * buyRatio), radius * 2, radius * 2 * (1 - buyRatio));

            ctx.restore();

            // Bubble Outline
            ctx.strokeStyle = isWhale ? '#ffffff' : 'rgba(255,255,255,0.4)';
            ctx.lineWidth = isWhale ? 2 : 0.5;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            // 📝 DELTA TEXT (Enhanced for visibility)
            if (radius > 10 || isWhale) {
                const fontSize = Math.max(8, Math.min(14, radius / 2.2));
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${fontSize}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                const deltaTxt = (delta > 0 ? '+' : '') + (Math.abs(delta) >= 1000 ? (delta / 1000).toFixed(1) + 'k' : delta.toFixed(0));

                // Text Glow/Shadow for readability
                ctx.shadowColor = '#000000';
                ctx.shadowBlur = 4;
                if (isWhale) {
                    ctx.fillStyle = '#ffff00'; // Highlight Whale Delta
                }

                ctx.fillText(deltaTxt, x, y);
                ctx.shadowBlur = 0;
            }

            // 🎯 INTERACTIVE TOOLTIP HIT DETECTION
            if (lastMouseX > 0 && lastMouseY > 0) {
                const dx = lastMouseX - x;
                const dy = lastMouseY - y;
                if (Math.sqrt(dx * dx + dy * dy) < radius + 5) {
                    hoveredBubble = {
                        x, y, radius, 
                        buyQty: t.buyQty, sellQty: t.sellQty, 
                        totalQty: totalQty, price: t.price, time: t.time 
                    };
                }
            }
        });

        // 📝 RENDER HOVER TOOLTIP
        if (hoveredBubble && !isDragging && !isRightDragging) {
            drawTooltip(ctx, hoveredBubble);
        }
        // Reset for next frame
        if (!isDragging && !isRightDragging) hoveredBubble = null;
    }

    // 🧱 ABSORPTION ZONES OVERLAY
    if (absorptionZones.length > 0) {
        absorptionZones.forEach(zone => {
            const y = getY(zone.price);
            if (y < 0 || y > h) return;

            const isBuy = zone.side === 'BUY';
            const isFresh = zone.ageSeconds < 30;
            const pulse = isFresh ? (0.6 + 0.4 * Math.sin(Date.now() / 200)) : 0.7;

            ctx.save();
            ctx.globalAlpha = pulse;

            // Dashed horizontal line
            ctx.strokeStyle = isBuy ? '#00ff88' : '#ff3366';
            ctx.lineWidth = isFresh ? 2 : 1.5;
            ctx.setLineDash([8, 4]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w - 110, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label
            const label = isBuy ? '↑ ABS' : '↓ ABS';
            ctx.fillStyle = isBuy ? '#00ff88' : '#ff3366';
            ctx.font = `bold 9px Inter`;
            ctx.textAlign = 'right';
            ctx.fillText(`${label} ${zone.strength.toFixed(1)}x`, w - 115, y + 4);

            ctx.restore();
        });
    }

    /* 🏆 INSTITUTIONAL WALLS (GOLDEN FRAMES) - REMOVED FOR CLEAN UI
    if (globalClusters.length > 0) {
        globalClusters.filter(c => ['FORTRESS', 'AAA', 'AA'].includes(c.rating)).forEach(cluster => {
            const y = getY(cluster.price);
            if (y < 0 || y > h) return;

            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#f59e0b';

            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = cluster.rating === 'FORTRESS' ? 4 : (cluster.rating === 'AAA' ? 3 : 2);
            ctx.setLineDash([12, 6]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w - 110, y);
            ctx.stroke();
            ctx.setLineDash([]);

            const ratingColor = { 'FORTRESS': '#ff00ff', 'AAA': '#f59e0b', 'AA': '#fbbf24' }[cluster.rating] || '#fff';
            const label = `🏆 ${cluster.rating} WALL (${cluster.exchanges.length} EXCH)`;
            const qtyLabel = `${Math.round(cluster.totalQty).toLocaleString()} ${heatmapPair.split('/')[0]}`;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(w - 105, y - 12, 100, 24);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1;
            ctx.strokeRect(w - 105, y - 12, 100, 24);

            ctx.fillStyle = ratingColor;
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'left';
            ctx.fillText(label, w - 100, y - 2);

            ctx.fillStyle = '#ffffff';
            ctx.font = '8px monospace';
            ctx.fillText(qtyLabel, w - 100, y + 8);

            ctx.restore();
        });
    }
    */

    // ⚡ TAPE SPEED METER
    const tpsX = w - 100; const tpsY = 40; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(tpsX - 10, tpsY - 20, 100, 40);
    ctx.fillStyle = currentTPS > 50 ? '#ff00ff' : '#00ffdd'; ctx.font = 'bold 12px Inter'; ctx.textAlign = 'left';
    ctx.fillText(`TPS: ${Math.round(currentTPS)}`, tpsX, tpsY);
    if (currentTPS > 80) { ctx.fillStyle = '#ff00ff'; ctx.font = 'bold 10px Inter'; ctx.fillText('🔥 FAST TAPE', tpsX, tpsY + 15); }

    // 🏷️ Y-AXIS PRICE LABELS (Vivid Professional Scale)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    const tickCount = 12;
    const priceStep = (maxPrice - minPrice) / tickCount;
    for (let i = 0; i <= tickCount; i++) {
        const p = minPrice + i * priceStep;
        const y = getY(p);
        if (y >= 10 && y <= h - 10) {
            ctx.fillText(p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), w - 10, y + 4);
            // Subtle horizontal grid line
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(0, y, w - 60, 1);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        }
    }
    ctx.restore();

    // ⚪ PRICE LINE (Only if candles hidden)
    if (!document.getElementById('showCandles')?.checked) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1; ctx.beginPath();
        heatSnapshots.forEach((s, idx) => { const x = getX(s.time); const y = getY(s.price); if (x < 0) return; if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
    }

    // 🕯️ CANDLESTICK RENDERING
    if (document.getElementById('showCandles')?.checked && klines.length > 0) {
        const candleWidth = (60000 / TIME_WINDOW_MS) * w * 0.8;
        klines.forEach(k => {
            const x = getX(k.time + 30000); // Center candle on its 1m minute
            if (x < -50 || x > w + 50) return;

            const yo = getY(k.open);
            const yh = getY(k.high);
            const yl = getY(k.low);
            const yc = getY(k.close);
            const color = k.close >= k.open ? '#10b981' : '#ef4444';

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yh);
            ctx.lineTo(x, yl);
            ctx.stroke();

            // Body
            ctx.save();
            ctx.globalAlpha = 0.4; // 🕯️ Lower opacity as requested
            ctx.fillStyle = color;
            const bodyH = Math.max(1, Math.abs(yc - yo));
            ctx.fillRect(x - candleWidth / 2, Math.min(yo, yc), candleWidth, bodyH);
            ctx.restore();

            // 🏷️ DELTA BADGE RENDERING
            const deltaVal = Math.round(k.delta || 0);
            if (deltaVal !== 0 || isLive) {
                const badgeW = 34; // Wider for text
                const badgeH = 18;
                const badgeY = yh - 25; // Above the wick

                // Connecting Line
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, yh);
                ctx.lineTo(x, badgeY + badgeH);
                ctx.stroke();

                // Round Rect Box
                ctx.fillStyle = deltaVal >= 0 ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
                ctx.strokeStyle = deltaVal >= 0 ? '#10b981' : '#ef4444';
                ctx.lineWidth = Math.abs(deltaVal) > 500 ? 2 : 1;

                if (Math.abs(deltaVal) > 1000) {
                    ctx.shadowColor = deltaVal >= 0 ? '#10b981' : '#ef4444';
                    ctx.shadowBlur = 10;
                }

                const bx = x - badgeW / 2;
                const by = badgeY;

                ctx.beginPath();
                ctx.roundRect(bx, by, badgeW, badgeH, 4);
                ctx.fill();
                ctx.stroke();
                ctx.shadowBlur = 0;

                // Delta Text
                ctx.fillStyle = '#ffffff'; // White for better contrast on colored background
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                let txt = Math.abs(deltaVal) >= 1000 ? (deltaVal / 1000).toFixed(1) + 'k' : deltaVal.toString();
                if (deltaVal > 0) txt = '+' + txt;
                ctx.fillText(txt, x, by + badgeH / 2);
            }
        });
    }

    // 📊 DELTA INTENSITY BARS (BOTTOM OVERLAY)
    if (document.getElementById('showDeltaBars')?.checked && klines.length > 0) {
        const barAreaH = 60;
        const barMaxWeight = 2000; // Threshold for max height
        const barW = (60000 / TIME_WINDOW_MS) * w * 0.7;

        klines.forEach(k => {
            const x = getX(k.time + 30000);
            if (x < 0 || x > w) return;

            const delta = k.delta || 0;
            const barH = (Math.min(Math.abs(delta), barMaxWeight) / barMaxWeight) * barAreaH;
            const color = delta >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)';

            ctx.fillStyle = color;
            ctx.fillRect(x - barW / 2, h - barH - 5, barW, barH);
            
            // Subtle top highlight for the bars
            ctx.fillStyle = delta >= 0 ? '#10b981' : '#ef4444';
            ctx.fillRect(x - barW / 2, h - barH - 5, barW, 2);
        });
    }
}

function drawDOM() {
    const canvas = document.getElementById('domCanvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    let w = canvas.width / dpr;
    let h = canvas.height / dpr;

    // Auto-resize from parent
    if (w < 10 || h < 10) {
        const parent = canvas.parentElement;
        if (parent && parent.clientWidth > 10) {
            canvas.width = parent.clientWidth * dpr;
            canvas.height = parent.clientHeight * dpr;
            w = parent.clientWidth;
            h = parent.clientHeight;
        } else return;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 🧱 MIRROR DARK Style Background
    ctx.fillStyle = '#080c14'; 
    ctx.fillRect(0, 0, w, h);

    const getY = (p) => h - ((p - minPrice) / (maxPrice - minPrice) * h);

    // 🔍 TICK CALCULATION (Dynamic per coin for high-fidelity)
    const priceRange = maxPrice - minPrice;
    const isBTC = heatmapPair.includes('BTC');
    const isSOL = heatmapPair.includes('SOL');
    // Standardized tickSize is already updated globally in renderLoop

    const startPrice = Math.floor(minPrice / tickSize) * tickSize;
    const endPrice = Math.ceil(maxPrice / tickSize) * tickSize;

    const domBuckets = {};
    const isDeepDepthSynced = deepDOMData.bids.length > 0;
    const isLiveSynced = lastDOMData.bids.length > 0;

    // 🏗️ HYBRID DATA MERGING (ATAS Style)
    const liveBins = new Set();
    const deepBins = new Set();

    const processLevel = (price, qty, type) => {
        const bin = Math.round(price / tickSize) * tickSize;
        
        // Apply Live Delta Sync (Subtract trades from book in real-time)
        let adjustedQty = qty;
        if (domDelta[bin]) {
            adjustedQty = Math.max(0, qty - domDelta[bin]);
        }

        if (bin >= startPrice && bin <= endPrice) {
            if (!domBuckets[bin]) domBuckets[bin] = { qty: 0, rating: null };
            
            if (type === 'LIVE') {
                if (!liveBins.has(bin)) {
                    domBuckets[bin].qty = 0;
                    liveBins.add(bin);
                }
                domBuckets[bin].qty += adjustedQty;
            } else if (type === 'DEEP' || type === 'HISTORICAL') {
                if (!liveBins.has(bin)) {
                    if (type === 'DEEP' && !deepBins.has(bin)) {
                        domBuckets[bin].qty = 0;
                        deepBins.add(bin);
                    }
                    domBuckets[bin].qty += adjustedQty;
                }
            } else {
                if (!liveBins.has(bin) && !deepBins.has(bin)) {
                    domBuckets[bin].qty += adjustedQty;
                }
            }
        }
    };

    const hasHistory = heatSnapshots.length > 0;

    if (!isDeepDepthSynced && !isLiveSynced && !hasHistory) {
        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("WAITING FOR DATA...", w / 2, h / 2);
        return;
    }

    // 1. Layer 1: LIVE data (High priority, 100ms updates)
    if (lastDOMData.bids && lastDOMData.bids.length > 0) {
        lastDOMData.bids.forEach(l => processLevel(l[0], l[1], 'LIVE'));
        lastDOMData.asks.forEach(l => processLevel(l[0], l[1], 'LIVE'));
    }

    // 2. Layer 2: DEEP data (Binance 1000 Levels)
    if (isDeepDepthSynced) {
        deepDOMData.bids.forEach(l => processLevel(l[0], l[1], 'DEEP'));
        deepDOMData.asks.forEach(l => processLevel(l[0], l[1], 'DEEP'));
    }

    // 3. Fallback to Historical Snapshots if no live/deep data
    if (!isLiveSynced && !isDeepDepthSynced && hasHistory) {
        const lastSnap = heatSnapshots[heatSnapshots.length - 1];
        if (lastSnap.bids) lastSnap.bids.forEach(l => processLevel(l[0], l[1], 'HISTORICAL'));
        if (lastSnap.asks) lastSnap.asks.forEach(l => processLevel(l[0], l[1], 'HISTORICAL'));
    }

    if (Object.keys(domBuckets).length === 0 && hasHistory) {
        // Final effort: if buckets are STILL empty (maybe tickSize is too small/big), just process everything with type GLOBAL
        const lastSnap = heatSnapshots[heatSnapshots.length - 1];
        lastSnap.bids.forEach(l => {
            const bin = Math.round(l[0] / tickSize) * tickSize;
            domBuckets[bin] = { qty: l[1], rating: null };
        });
        lastSnap.asks.forEach(l => {
            const bin = Math.round(l[0] / tickSize) * tickSize;
            domBuckets[bin] = { qty: l[1], rating: null };
        });
    }

    // 3. Layer 3: GLOBAL RAW data (Merged from 9 exchanges, massive range)
    if (globalRawDepth.length > 0) {
        globalRawDepth.forEach(ex => {
            if (ex.bids) ex.bids.forEach(l => processLevel(l[0], l[1], 'GLOBAL'));
            if (ex.asks) ex.asks.forEach(l => processLevel(l[0], l[1], 'GLOBAL'));
        });
    }

    /* 4. APPLY GOLDEN WALL RATINGS (DISABLED)
    if (globalClusters.length > 0) {
        globalClusters.filter(c => ['FORTRESS', 'AAA', 'AA'].includes(c.rating)).forEach(c => {
            const bin = Math.round(c.price / tickSize) * tickSize;
            if (domBuckets[bin]) {
                domBuckets[bin].rating = c.rating;
            }
        });
    }
    */

    // Status Indicator
    ctx.fillStyle = isDeepDepthSynced ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)';
    ctx.font = '8px Inter';
    ctx.textAlign = 'center';
    const deepStatus = isDeepDepthSynced ? `DEEP: ${deepDOMData.bids.length + deepDOMData.asks.length}L` : "SYNCING DEEP...";
    const liveStatus = isLiveSynced ? `LIVE: ${lastDOMData.bids.length + lastDOMData.asks.length}L` : "LIVE: 0";
    const globalCount = globalRawDepth.reduce((acc, ex) => acc + (ex.bids ? ex.bids.length : 0) + (ex.asks ? ex.asks.length : 0), 0);
    const globalStatus = `GLOBAL: ${globalCount}L`;
    ctx.fillText(`${deepStatus} | ${liveStatus} | ${globalStatus}`, w / 2, 12);

    /* Step C: Apply Institutional Ratings (DISABLED)
    globalClusters.forEach(c => {
        const bin = Math.floor(c.price / tickSize) * tickSize;
        if (bin >= startPrice && bin <= endPrice) {
            if (domBuckets[bin]) {
                domBuckets[bin].rating = c.rating;
            }
        }
    });
    */

    // 🏗️ GAPLESS GRID RENDERING
    // Instead of iterating over data, we iterate over the PRICE RANGE to fill all empty spaces
    const priceLevels = [];
    for (let p = endPrice; p >= startPrice; p -= tickSize) {
        const bin = Math.round(p / tickSize) * tickSize;
        const bucket = domBuckets[bin] || { qty: 0, rating: null };
        priceLevels.push({ price: p, bin: bin, ...bucket });
    }

    const maxQty = Math.max(...priceLevels.map(b => b.qty), 1);
    const unit = heatmapPair.split('/')[0].toLowerCase();

    // 🎨 MIRROR CELL RENDERING
    priceLevels.forEach(b => {
        const y = getY(b.price);
        const nextY = getY(b.price + tickSize);
        const rowH = Math.abs(y - nextY);
        const rowTop = Math.min(y, nextY);

        if (rowTop < -20 || rowTop > h + 20) return;

        const isAsk = b.price >= currentPrice;
        const color = isAsk ? '#f87171' : '#10b981'; 
        const cellBg = isAsk ? 'rgba(239, 68, 68, 0.04)' : 'rgba(16, 185, 129, 0.04)';

        // 1. Draw Cell Background (Always drawn for gapless look)
        ctx.fillStyle = cellBg;
        ctx.fillRect(8, rowTop + 1, w - 16, rowH - 2);
        
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(8, rowTop + 1, w - 16, rowH - 2);
        
        // 2. Volume Bar (Right-aligned background)
        if (b.qty > 0 || (domHeatHits[b.bin]?.time > Date.now() - 500)) {
            const hit = domHeatHits[b.bin];
            const isHit = hit && (hit.time > Date.now() - 300);
            const extraQty = isHit ? hit.qty : 0;
            
            // Ensure even very small volumes (0.1 BTC) have a visible 2px bar minimum
            const barW = Math.max(2, ((b.qty + extraQty) / maxQty) * (w - 20));
            
            if (isHit) {
                // Pulse Effect (ATAS Style)
                ctx.fillStyle = isAsk ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.6)';
                ctx.fillRect(w - 8 - barW, rowTop + 1, barW, rowH - 2);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(w - 8 - barW, rowTop + 1, barW, rowH - 2);
            } else {
                ctx.fillStyle = isAsk ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)';
                ctx.fillRect(w - 8 - barW, rowTop + 2, barW, rowH - 4);
            }
        }

        // 3. Institutional Golden Border (REMOVED as per user request for clean UI)
        /*
        if (b.rating) {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = b.rating === 'FORTRESS' ? 2 : 1.5;
            ctx.strokeRect(8, rowTop + 1, w - 16, rowH - 2);
        }
        */

        // 4. MIRROR LABELS
        if (rowH > 9) {
            // Price (LEFT-ALIGNED)
            const precision = getPricePrecision(tickSize);
            const isEverySecond = Math.round(b.price / tickSize) % 2 === 0;
            
            // THIN LABELS if rows are very small (ATAS style)
            if (rowH > 14 || isEverySecond) {
                ctx.fillStyle = color;
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(b.price.toFixed(precision), 15, rowTop + rowH / 2);
            }

            // Quantity (RIGHT-ALIGNED)
            if (b.qty > 0) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'right';
                
                let qtyText = Math.round(b.qty).toLocaleString();
                if (b.qty >= 1000) qtyText = (b.qty / 1000).toFixed(1) + 'k';
                ctx.fillText(qtyText, w - 40, rowTop + rowH / 2);
                
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '8px monospace';
                ctx.fillText(unit, w - 15, rowTop + rowH / 2);
            }
        }
    });

    // 5. Current Price Marker (MIRROR White Flag)
    const cy = getY(currentPrice);
    if (cy >= 0 && cy <= h) {
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#fff';
        ctx.fillRect(0, cy - 1, w, 2);
        ctx.shadowBlur = 0;
        
        ctx.fillRect(w - 65, cy - 11, 65, 22);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(currentPrice.toFixed(2), w - 32, cy);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}
