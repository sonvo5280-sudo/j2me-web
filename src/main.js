import { LibMedia } from "../libmedia/libmedia.js";
import { LibMidi, createUnlockingAudioContext } from "../libmidi/libmidi.js";
import { codeMap, KeyRepeatManager } from "./key.js";
import { EventQueue } from "./eventqueue.js";
import { initKbdListeners, setKbdHandler, highlightKeyFromCode, setVirtualKbdDisabled, isVirtualKbdDisabled } from "./screenKbd.js";

// Import natives for CheerpJ runtime
import canvasFontNatives from "../libjs/libcanvasfont.js";
import canvasGraphicsNatives from "../libjs/libcanvasgraphics.js";
import gles2Natives from "../libjs/libgles2.js";
import jsReferenceNatives from "../libjs/libjsreference.js";
import mediaBridgeNatives from "../libjs/libmediabridge.js";
import midiBridgeNatives from "../libjs/libmidibridge.js";
import socketBridgeNatives from "../libjs/libsocketbridge.js";
import httpBridgeNatives from "../libjs/libhttpbridge.js";

const evtQueue = new EventQueue();
const sp = new URLSearchParams(location.search);

const cheerpjWebRoot = '/app' + location.pathname.replace(/\/[^/]*$/, '');

let display = null;
let screenCtx = null;
let scaleSet = false;
let globalLib = null;
let currentRunningAppId = null;

const keyRepeatManager = new KeyRepeatManager();
window.evtQueue = evtQueue;

// ============================================================================
// Layout & Display Auto-Scaling (Screen strictly on top, keypad below)
// ============================================================================
function autoscale() {
    if (!scaleSet || !screenCtx || !screenCtx.canvas.width) return;
    if (document.activeElement && document.activeElement.id === 'mobile-text-input') return;

    const screenArea = document.getElementById('screen-area');
    if (!screenArea) return;

    const pad = 6;
    const availW = Math.max(60, screenArea.clientWidth - pad);
    const availH = Math.max(60, screenArea.clientHeight - pad);

    const canvasW = screenCtx.canvas.width || 240;
    const canvasH = screenCtx.canvas.height || 320;

    let scale = Math.min(availW / canvasW, availH / canvasH);
    if (scale <= 0) scale = 1;

    display.style.width = Math.round(canvasW * scale) + 'px';
    display.style.height = Math.round(canvasH * scale) + 'px';
    display.style.zoom = '1';
}

// ============================================================================
// Input & Key Event Listeners (Mouse, Touch, and PC Keyboard)
// ============================================================================
function setListeners() {
    let mouseDown = false;
    let noMouse = false;

    const activePhysicalKeys = new Map();

    // Connect virtual keypad handler (for touch/mouse on virtual keypad)
    setKbdHandler((isDown, key) => {
        let symbol = '\x00';
        if (key && key.startsWith('Digit')) {
            symbol = key.substring(5);
        } else if (key === 'NumpadAsterisk' || key === 'NumpadMultiply') {
            symbol = '*';
        } else if (key === 'NumpadDivide') {
            symbol = '#';
        }
        keyRepeatManager.post(isDown, key, { symbol, ctrlKey: false, shiftKey: false });
    });

    keyRepeatManager.register((kind, key, args) => {
        // Do NOT emit on 'click' to avoid duplicate keydown
        if (kind === 'click') return;
        if (codeMap[key]) {
            if (kind === 'repeat') {
                // Pulse keyup then keydown for J2ME GameCanvas repeat compatibility
                evtQueue.queueEvent({
                    kind: 'keyup',
                    args: [codeMap[key], args.symbol, args.ctrlKey, args.shiftKey]
                });
            }
            evtQueue.queueEvent({
                kind: kind === 'up' ? 'keyup' : 'keydown',
                args: [codeMap[key], args.symbol, args.ctrlKey, args.shiftKey]
            });
        }
    });

    // Strict physical PC keyboard mapper (Navigation, Actions, Digits, Backspace & Direct Typing)
    function getPhysicalKeyMapping(e) {
        // 1. Di chuyển: CHỈ DÙNG phím mũi tên ▲ ▼ ◄ ► (Tuyệt đối không dùng WASD)
        if (e.code === 'ArrowUp') return { code: 38, symbol: '\x00', platformCode: -1, normalizedCode: -1, name: 'ArrowUp' };
        if (e.code === 'ArrowDown') return { code: 40, symbol: '\x00', platformCode: -2, normalizedCode: -2, name: 'ArrowDown' };
        if (e.code === 'ArrowLeft') return { code: 37, symbol: '\x00', platformCode: -3, normalizedCode: -3, name: 'ArrowLeft' };
        if (e.code === 'ArrowRight') return { code: 39, symbol: '\x00', platformCode: -4, normalizedCode: -4, name: 'ArrowRight' };

        // 2. Phím chọn: CHỈ Enter (Enter chính và Numpad Enter, loại bỏ hoàn toàn Space)
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            return { code: 13, symbol: '\x00', platformCode: -5, normalizedCode: -5, name: 'Enter' };
        }

        // 3. Phím mềm trái F1, phím mềm phải F2 (Loại bỏ hoàn toàn Q và E)
        if (e.code === 'F1') return { code: 112, symbol: '\x00', platformCode: -6, normalizedCode: -6, name: 'F1' };
        if (e.code === 'F2') return { code: 113, symbol: '\x00', platformCode: -7, normalizedCode: -7, name: 'F2' };

        // 4. Hủy / Thoát: CHỈ phím Esc (Loại bỏ hoàn toàn C)
        if (e.code === 'Escape') return { code: 27, symbol: '\x00', platformCode: 27, normalizedCode: 27, name: 'Escape' };

        // 5. Bàn phím số J2ME (Hàng phím số và Numpad)
        if (e.code === 'Digit0' || e.code === 'Numpad0') return { code: 48, symbol: '0', platformCode: 48, normalizedCode: 48, name: 'Digit0' };
        if (e.code === 'Digit1' || e.code === 'Numpad1') return { code: 49, symbol: '1', platformCode: 49, normalizedCode: 49, name: 'Digit1' };
        if (e.code === 'Digit2' || e.code === 'Numpad2') return { code: 50, symbol: '2', platformCode: 50, normalizedCode: -1, name: 'Digit2' };
        if (e.code === 'Digit3' || e.code === 'Numpad3') return { code: 51, symbol: '3', platformCode: 51, normalizedCode: 51, name: 'Digit3' };
        if (e.code === 'Digit4' || e.code === 'Numpad4') return { code: 52, symbol: '4', platformCode: 52, normalizedCode: -3, name: 'Digit4' };
        if (e.code === 'Digit5' || e.code === 'Numpad5') return { code: 53, symbol: '5', platformCode: 53, normalizedCode: -5, name: 'Digit5' };
        if (e.code === 'Digit6' || e.code === 'Numpad6') return { code: 54, symbol: '6', platformCode: 54, normalizedCode: -4, name: 'Digit6' };
        if (e.code === 'Digit7' || e.code === 'Numpad7') return { code: 55, symbol: '7', platformCode: 55, normalizedCode: 55, name: 'Digit7' };
        if (e.code === 'Digit8' || e.code === 'Numpad8') return { code: 56, symbol: '8', platformCode: 56, normalizedCode: -2, name: 'Digit8' };
        if (e.code === 'Digit9' || e.code === 'Numpad9') return { code: 57, symbol: '9', platformCode: 57, normalizedCode: 57, name: 'Digit9' };

        // 6. Phím sao (*) và thăng (#) trên Numpad
        if (e.code === 'NumpadMultiply') return { code: 106, symbol: '*', platformCode: 42, normalizedCode: 42, name: 'NumpadAsterisk' };
        if (e.code === 'NumpadDivide') return { code: 111, symbol: '#', platformCode: 35, normalizedCode: 35, name: 'NumpadDivide' };

        // 7. Phím xóa Backspace & Delete (Khôi phục hoàn toàn cho soạn thảo / nhập chữ và game Canvas)
        if (e.code === 'Backspace') {
            return {
                code: 8,
                symbol: '\x08',
                platformCode: -8,
                normalizedCode: -8,
                name: 'Backspace',
                isTypingKey: true
            };
        }
        if (e.code === 'Delete') {
            return {
                code: 46,
                symbol: '\x7f',
                platformCode: -8,
                normalizedCode: -8,
                name: 'Delete',
                isTypingKey: true
            };
        }

        // 8. Phím Space (Dấu cách nhập văn bản)
        if (e.code === 'Space') {
            return {
                code: 32,
                symbol: ' ',
                platformCode: 32,
                normalizedCode: 32,
                name: 'Space',
                isTypingKey: true
            };
        }

        // 9. Gõ chữ trực tiếp (A-Z, a-z, dấu câu, ký tự đặc biệt) - LOẠI BỎ MULTI-TAP
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const charCode = e.key.charCodeAt(0);
            return {
                code: charCode,
                symbol: e.key,
                platformCode: charCode,
                normalizedCode: charCode,
                name: e.code,
                isTypingKey: true
            };
        }

        return null;
    }

    // Direct, ultra-responsive PC physical keyboard dispatcher
    function handleKeyEvent(e) {
        // Hoàn toàn không can thiệp nếu người dùng đang nhập văn bản trong DOM trang web
        if (e.target && (
            e.target.tagName === 'INPUT' || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.isContentEditable || 
            e.target.closest('.modal-content')
        )) {
            return;
        }

        const mapped = getPhysicalKeyMapping(e);
        if (!mapped) return;

        // Prevent browser default actions (scrolling on arrows, back on Backspace, F1 help, etc.)
        e.preventDefault();
        e.stopPropagation();

        if (e.type === 'keydown') {
            if (e.repeat) {
                // Browser auto-repeat: pulse a quick keyup then keydown so all J2ME games register smooth continuous hold
                evtQueue.queueEvent({
                    kind: 'keyup',
                    ...mapped,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    args: [mapped.code, mapped.symbol, e.ctrlKey, e.shiftKey]
                });
                evtQueue.queueEvent({
                    kind: 'keydown',
                    ...mapped,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    args: [mapped.code, mapped.symbol, e.ctrlKey, e.shiftKey]
                });
                return;
            }

            activePhysicalKeys.set(e.code, mapped);

            evtQueue.queueEvent({
                kind: 'keydown',
                ...mapped,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                args: [mapped.code, mapped.symbol, e.ctrlKey, e.shiftKey]
            });
        } else if (e.type === 'keyup') {
            const active = activePhysicalKeys.get(e.code) || mapped;
            activePhysicalKeys.delete(e.code);

            evtQueue.queueEvent({
                kind: 'keyup',
                ...active,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                args: [active.code, active.symbol, e.ctrlKey, e.shiftKey]
            });
        }
    }

    window.addEventListener('keydown', handleKeyEvent, { capture: true });
    window.addEventListener('keyup', handleKeyEvent, { capture: true });

    // Safety: Release all pressed keys when browser window loses focus
    window.addEventListener('blur', () => {
        for (const [code, mapped] of activePhysicalKeys.entries()) {
            evtQueue.queueEvent({
                kind: 'keyup',
                ...mapped,
                ctrlKey: false,
                shiftKey: false,
                args: [mapped.code, mapped.symbol, false, false]
            });
        }
        activePhysicalKeys.clear();
        keyRepeatManager.reset();
    });

    // Pointer events on canvas
    display.addEventListener('mousedown', async e => {
        display.focus();
        if (noMouse) return;
        const rect = display.getBoundingClientRect();
        const scaleX = screenCtx.canvas.width / rect.width;
        const scaleY = screenCtx.canvas.height / rect.height;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: Math.floor((e.clientX - rect.left) * scaleX),
            y: Math.floor((e.clientY - rect.top) * scaleY),
        });
        mouseDown = true;
        e.preventDefault();
    });

    display.addEventListener('mousemove', async e => {
        if (noMouse || !mouseDown) return;
        const rect = display.getBoundingClientRect();
        const scaleX = screenCtx.canvas.width / rect.width;
        const scaleY = screenCtx.canvas.height / rect.height;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: Math.floor((e.clientX - rect.left) * scaleX),
            y: Math.floor((e.clientY - rect.top) * scaleY),
        });
        e.preventDefault();
    });

    document.addEventListener('mouseup', async e => {
        if (noMouse || !mouseDown) return;
        mouseDown = false;
        const rect = display.getBoundingClientRect();
        const scaleX = screenCtx.canvas.width / rect.width;
        const scaleY = screenCtx.canvas.height / rect.height;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: Math.floor((e.clientX - rect.left) * scaleX),
            y: Math.floor((e.clientY - rect.top) * scaleY),
        });
        e.preventDefault();
    });

    // Mobile touch events on canvas
    display.addEventListener('touchstart', async e => {
        display.focus();
        noMouse = true;
        const rect = display.getBoundingClientRect();
        const touch = e.changedTouches[0];
        const scaleX = screenCtx.canvas.width / rect.width;
        const scaleY = screenCtx.canvas.height / rect.height;

        evtQueue.queueEvent({
            kind: 'pointerpressed',
            x: Math.floor((touch.clientX - rect.left) * scaleX),
            y: Math.floor((touch.clientY - rect.top) * scaleY),
        });
        e.preventDefault();
    }, { passive: false });

    display.addEventListener('touchmove', async e => {
        noMouse = true;
        const rect = display.getBoundingClientRect();
        const touch = e.changedTouches[0];
        const scaleX = screenCtx.canvas.width / rect.width;
        const scaleY = screenCtx.canvas.height / rect.height;

        evtQueue.queueEvent({
            kind: 'pointerdragged',
            x: Math.floor((touch.clientX - rect.left) * scaleX),
            y: Math.floor((touch.clientY - rect.top) * scaleY),
        });
        e.preventDefault();
    }, { passive: false });

    display.addEventListener('touchend', async e => {
        noMouse = true;
        const rect = display.getBoundingClientRect();
        const touch = e.changedTouches[0];
        const scaleX = screenCtx.canvas.width / rect.width;
        const scaleY = screenCtx.canvas.height / rect.height;

        evtQueue.queueEvent({
            kind: 'pointerreleased',
            x: Math.floor((touch.clientX - rect.left) * scaleX),
            y: Math.floor((touch.clientY - rect.top) * scaleY),
        });
        e.preventDefault();
    });

    window.addEventListener('resize', autoscale);
    window.addEventListener('orientationchange', () => setTimeout(autoscale, 150));
    if (window.screen && window.screen.orientation) {
        window.screen.orientation.addEventListener('change', () => setTimeout(autoscale, 150));
    }
    initKbdListeners();
}

function setFaviconFromBuffer(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/png' });
    const reader = new FileReader();
    reader.onload = function() {
        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'icon');
            document.head.appendChild(link);
        }
        link.setAttribute('href', reader.result);
    };
    reader.readAsDataURL(blob);
}

// ============================================================================
async function ensureAppFpsConfig(lib, appId) {
    if (!lib || !appId) return;
    const targetFps = localStorage.getItem('j2me_target_fps') || '30';
    try {
        const File = await lib.java.io.File;
        const confDir = await new File("/files/" + appId + "/config");
        await confDir.mkdirs();
        const confFile = await new File("/files/" + appId + "/config/settings.conf");
        let content = "";
        const blob = await cjFileBlob("/files/" + appId + "/config/settings.conf");
        if (blob) {
            content = await blob.text();
        }
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('fps:'));
        lines.push('fps:' + targetFps);
        const fw = await new (await lib.java.io.FileWriter)(confFile);
        await fw.write(lines.join('\n') + '\n');
        await fw.close();
    } catch (e) {
        console.warn("Lỗi đồng bộ FPS config:", e);
    }
}

async function ensureAppInstalled(lib, appId) {
    let appFile = await cjFileBlob("/files/" + appId + "/app.jar");
    if (!appFile) {
        const launcherUtil = await lib.pl.zb3.freej2me.launcher.LauncherUtil;
        try {
            const res = await fetch("init.zip");
            if (res.ok) {
                const ab = await res.arrayBuffer();
                await launcherUtil.importData(new Int8Array(ab));
            }
        } catch (e) {
            console.warn("importData init.zip error:", e);
        }
    }
    await ensureAppFpsConfig(lib, appId);
}

// ============================================================================
// JAR File Installation (Drag-and-Drop & File Picker)
// ============================================================================
export async function installAndPlayJar(file) {
    const loadingText = document.getElementById("loading-text");
    const indicator = document.getElementById("loading-indicator");
    if (indicator) indicator.style.display = "flex";
    if (loadingText) loadingText.textContent = "Đang cài đặt " + file.name + "...";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const launcherUtil = await globalLib.pl.zb3.freej2me.launcher.LauncherUtil;
        const MIDletLoader = await globalLib.org.recompile.mobile.MIDletLoader;
        const File = await globalLib.java.io.File;

        // Write temp JAR
        const tmpJar = await new File("/files/_tmp/" + Date.now() + ".jar");
        await launcherUtil.copyJar(new Int8Array(arrayBuffer), tmpJar);

        // Analyze JAR
        const loader = await MIDletLoader.getMIDletLoader(tmpJar);
        let appId = await loader.getAppId();
        if (!appId) {
            await launcherUtil.ensureAppId(loader, file.name);
            appId = await loader.getAppId();
        }
        const appName = loader.name || appId;

        // Create app directory
        const targetDir = await new File("/files/" + appId);
        await targetDir.mkdirs();

        // Copy app.jar
        const appJarFile = await new File("/files/" + appId + "/app.jar");
        await launcherUtil.copyJar(new Int8Array(arrayBuffer), appJarFile);

        // Save name
        const nameFile = await new File("/files/" + appId + "/name");
        const fw = await new (await globalLib.java.io.FileWriter)(nameFile);
        await fw.write(appName);
        await fw.close();

        // Save icon if present
        const iconBytes = await loader.getIconBytes();
        if (iconBytes) {
            const iconFile = await new File("/files/" + appId + "/icon");
            const fos = await new (await globalLib.java.io.FileOutputStream)(iconFile);
            await fos.write(iconBytes);
            await fos.close();
        }

        // Add to apps.list
        let currentList = "";
        const listBlob = await cjFileBlob("/files/apps.list");
        if (listBlob) {
            currentList = await listBlob.text();
        }
        const apps = currentList.trim().split("\n").filter(Boolean);
        if (!apps.includes(appId)) {
            apps.push(appId);
            const listFile = await new File("/files/apps.list");
            const lfw = await new (await globalLib.java.io.FileWriter)(listFile);
            await lfw.write(apps.join("\n") + "\n");
            await lfw.close();
        }

        // Save last played app
        localStorage.setItem('j2me_last_played_app', appId);

        // Reboot into the new game!
        location.href = '?app=' + encodeURIComponent(appId);
    } catch (err) {
        console.error("Lỗi cài đặt game:", err);
        alert("Lỗi cài đặt file .jar: " + err.message);
        if (indicator) indicator.style.display = "none";
    }
}

// Xóa đệ quy file/thư mục trong hệ thống tệp ảo CheerpJ
async function deleteJavaFileRecursive(file) {
    if (!file) return;
    try {
        if (await file.isDirectory()) {
            const children = await file.listFiles();
            if (children) {
                for (let i = 0; i < children.length; i++) {
                    await deleteJavaFileRecursive(children[i]);
                }
            }
        }
        await file.delete();
    } catch (e) {
        console.warn("Lỗi khi xóa file:", e);
    }
}

// Xóa bộ nhớ đệm (Record Management System / RMS) của trò chơi
export async function clearAppRms(appId) {
    if (!globalLib) return false;
    try {
        const File = await globalLib.java.io.File;
        const rmsDir = await new File("/files/" + appId + "/rms");
        if (await rmsDir.exists()) {
            await deleteJavaFileRecursive(rmsDir);
            await rmsDir.mkdirs();
        }
        return true;
    } catch (e) {
        console.error("Lỗi xóa RMS cho " + appId + ":", e);
        return false;
    }
}

// Gỡ cài đặt hoàn toàn trò chơi đã cài
export async function uninstallApp(appId) {
    if (!globalLib) return false;
    try {
        const File = await globalLib.java.io.File;
        const appDir = await new File("/files/" + appId);
        if (await appDir.exists()) {
            await deleteJavaFileRecursive(appDir);
        }

        // Cập nhật danh sách apps.list
        const listBlob = await cjFileBlob("/files/apps.list");
        if (listBlob) {
            const currentList = await listBlob.text();
            const apps = currentList.trim().split("\n").filter(id => id && id.trim() !== appId);
            const listFile = await new File("/files/apps.list");
            const lfw = await new (await globalLib.java.io.FileWriter)(listFile);
            await lfw.write(apps.join("\n") + (apps.length ? "\n" : ""));
            await lfw.close();
        }

        if (localStorage.getItem('j2me_last_played_app') === appId) {
            localStorage.removeItem('j2me_last_played_app');
        }
        return true;
    } catch (e) {
        console.error("Lỗi gỡ ứng dụng " + appId + ":", e);
        return false;
    }
}

// Fetch all installed games from CheerpJ virtual storage
export async function getInstalledGames() {
    let installedAppsBlob = await cjFileBlob("/files/apps.list");
    if (!installedAppsBlob) {
        return [
            { appId: 'Connect4', name: 'Connect 4' },
            { appId: 'k4kur0', name: 'Kakuro' }
        ];
    }
    const text = await installedAppsBlob.text();
    const ids = text.trim().split("\n").filter(Boolean);
    const games = [];

    for (const id of ids) {
        let name = id;
        const nameBlob = await cjFileBlob("/files/" + id + "/name");
        if (nameBlob) name = (await nameBlob.text()).trim() || id;

        let icon = null;
        const iconBlob = await cjFileBlob("/files/" + id + "/icon");
        if (iconBlob) {
            icon = URL.createObjectURL(iconBlob);
        }
        games.push({ appId: id, name, icon });
    }
    return games;
}

// ============================================================================
// UI Controls Setup (Toolbar, Modals, Drag-Drop)
// ============================================================================
function initUIControls() {
    const fileInput = document.getElementById('jar-file-input');
    const btnLoadJar = document.getElementById('btn-load-jar');
    const btnGamesModal = document.getElementById('btn-games-modal');
    const btnHelpModal = document.getElementById('btn-help-modal');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnMute = document.getElementById('btn-mute');
    const btnCrt = document.getElementById('btn-crt');
    const btnToggleTb = document.getElementById('btn-toggle-toolbar');
    const topToolbar = document.getElementById('top-toolbar');
    const btnStopGame = document.getElementById('btn-stop-game');

    // Nút dừng trò chơi / đổi game
    if (btnStopGame) {
        btnStopGame.onclick = () => {
            localStorage.removeItem('j2me_last_played_app');
            location.href = location.pathname;
        };
    }

    // Nút trên màn hình Empty State
    const btnEmptyGames = document.getElementById('btn-empty-games');
    const btnEmptyLoadJar = document.getElementById('btn-empty-load-jar');
    if (btnEmptyGames && btnGamesModal) {
        btnEmptyGames.onclick = () => btnGamesModal.click();
    }
    if (btnEmptyLoadJar && fileInput) {
        btnEmptyLoadJar.onclick = () => fileInput.click();
    }

    // File input triggers
    if (btnLoadJar && fileInput) {
        btnLoadJar.onclick = () => fileInput.click();
    }
    if (fileInput) {
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) installAndPlayJar(file);
        };
    }

    // Drag and Drop zone over screen area
    const screenArea = document.getElementById('screen-area');
    const dropOverlay = document.getElementById('drop-zone-overlay');

    if (screenArea && dropOverlay) {
        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dropOverlay.classList.add('active');
        });
        window.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        dropOverlay.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropOverlay.classList.remove('active');
        });
        window.addEventListener('drop', (e) => {
            e.preventDefault();
            dropOverlay.classList.remove('active');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const file = e.dataTransfer.files[0];
                if (file.name.toLowerCase().endsWith('.jar')) {
                    installAndPlayJar(file);
                } else {
                    alert("Vui lòng chọn file game định dạng .jar của Java J2ME!");
                }
            }
        });
    }

    // Toggle Toolbar for ultra-clean "only screen and buttons" vibe
    if (btnToggleTb && topToolbar) {
        btnToggleTb.onclick = () => {
            topToolbar.classList.toggle('hidden');
            btnToggleTb.textContent = topToolbar.classList.contains('hidden') ? '▼' : '▲';
            setTimeout(autoscale, 260);
        };
    }

    // Fullscreen Toggle
    if (btnFullscreen) {
        btnFullscreen.onclick = () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        };
    }

    // Screen Wake Lock (Chống tắt màn hình khi treo game 24/7)
    const btnWakeLock = document.getElementById('btn-wakelock');
    let wakeLockSentinel = null;
    let wakeLockEnabled = localStorage.getItem('j2me_wakelock_enabled') !== '0';

    async function applyWakeLock() {
        if (!('wakeLock' in navigator)) {
            if (btnWakeLock) {
                btnWakeLock.innerHTML = '<span>🔆</span> <span class="btn-text">Sáng: K.Hỗ trợ</span>';
                btnWakeLock.title = "Trình duyệt này không hỗ trợ Screen Wake Lock API";
            }
            return;
        }
        if (wakeLockEnabled) {
            try {
                if (!wakeLockSentinel) {
                    wakeLockSentinel = await navigator.wakeLock.request('screen');
                    wakeLockSentinel.addEventListener('release', () => {
                        wakeLockSentinel = null;
                    });
                }
                if (btnWakeLock) {
                    btnWakeLock.innerHTML = '<span>🔆</span> <span class="btn-text">Sáng: Bật</span>';
                    btnWakeLock.classList.add('active');
                    btnWakeLock.title = "Chống tắt màn hình đang BẬT: Màn hình sẽ luôn sáng để treo game";
                }
            } catch (err) {
                console.warn('[WakeLock] Không thể yêu cầu giữ màn hình:', err);
            }
        } else {
            if (wakeLockSentinel) {
                try {
                    await wakeLockSentinel.release();
                } catch (_) {}
                wakeLockSentinel = null;
            }
            if (btnWakeLock) {
                btnWakeLock.innerHTML = '<span>🌙</span> <span class="btn-text">Sáng: Tắt</span>';
                btnWakeLock.classList.remove('active');
                btnWakeLock.title = "Chống tắt màn hình đang TẮT: Thiết bị sẽ tự tắt màn hình theo cài đặt máy";
            }
        }
    }

    if (btnWakeLock) {
        btnWakeLock.onclick = async () => {
            wakeLockEnabled = !wakeLockEnabled;
            localStorage.setItem('j2me_wakelock_enabled', wakeLockEnabled ? '1' : '0');
            await applyWakeLock();
        };
    }

    // Tự động yêu cầu lại WakeLock khi người dùng chuyển lại tab (sau khi bị suspend)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && wakeLockEnabled) {
            applyWakeLock();
        }
    });

    // Kích hoạt ngay khi có tương tác đầu tiên (tránh browser policy chặn background wakeLock)
    const enableWakeLockOnGesture = () => {
        if (wakeLockEnabled) applyWakeLock();
    };
    window.addEventListener('click', enableWakeLockOnGesture, { once: true, passive: true });
    window.addEventListener('touchstart', enableWakeLockOnGesture, { once: true, passive: true });
    applyWakeLock();

    // Toggle Virtual Keypad Disable / Hide
    const btnToggleKeypad = document.getElementById('btn-toggle-keypad');

    function updateKeypadState(disabled) {
        setVirtualKbdDisabled(disabled);
        document.body.classList.toggle('keypad-disabled', disabled);
        if (btnToggleKeypad) {
            btnToggleKeypad.innerHTML = disabled ? '<span>⌨️</span> <span class="btn-text">Phím: Tắt</span>' : '<span>⌨️</span> <span class="btn-text">Phím: Bật</span>';
            btnToggleKeypad.classList.toggle('active', disabled);
            btnToggleKeypad.blur();
        }
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
            document.activeElement.blur();
        }
        if (display) display.focus();
        localStorage.setItem('j2me_disable_virtual_keypad', disabled ? '1' : '0');
        setTimeout(autoscale, 60);
    }

    // Load saved preference
    const savedKeypadDisabled = localStorage.getItem('j2me_disable_virtual_keypad') === '1';
    updateKeypadState(savedKeypadDisabled);

    if (btnToggleKeypad) {
        btnToggleKeypad.onclick = () => {
            const currentDisabled = isVirtualKbdDisabled();
            updateKeypadState(!currentDisabled);
        };
    }

    // FPS Selector (30 / 45 / 60 FPS, mặc định là 30 FPS)
    const btnFps = document.getElementById('btn-fps');
    const fpsLabel = document.getElementById('fps-label');
    const FPS_OPTIONS = [30, 45, 60];
    let currentFps = parseInt(localStorage.getItem('j2me_target_fps') || '30', 10);
    if (!FPS_OPTIONS.includes(currentFps)) currentFps = 30;

    function updateFpsDisplay(fps) {
        if (fpsLabel) fpsLabel.textContent = fps + ' FPS';
        if (btnFps) btnFps.title = `Tốc độ khung hình: ${fps} FPS (Bấm để chuyển 30 / 45 / 60 FPS)`;
    }
    updateFpsDisplay(currentFps);

    if (btnFps) {
        btnFps.onclick = async () => {
            const idx = FPS_OPTIONS.indexOf(currentFps);
            currentFps = FPS_OPTIONS[(idx + 1) % FPS_OPTIONS.length];
            localStorage.setItem('j2me_target_fps', String(currentFps));
            updateFpsDisplay(currentFps);

            if (globalLib && currentRunningAppId) {
                await ensureAppFpsConfig(globalLib, currentRunningAppId);
            }
        };
    }

    // Native Mobile Keyboard Opener (Icon "Bàn phím" ⌨️)
    const btnOpenMobileKb = document.getElementById('btn-open-mobile-keyboard');
    const mobileTextInput = document.getElementById('mobile-text-input');

    if (btnOpenMobileKb && mobileTextInput) {
        btnOpenMobileKb.addEventListener('pointerdown', (e) => {
            // Kiểm tra: nếu trên máy tính thì không có gì xảy ra hết theo đúng yêu cầu
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            if (!isTouch) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // Mở bàn phím ảo của điện thoại không cuộn trang
            mobileTextInput.value = '';
            mobileTextInput.focus({ preventScroll: true });
            window.scrollTo(0, 0);
        });

        const resetScroll = () => {
            window.scrollTo(0, 0);
            if (document.body) document.body.scrollTop = 0;
            if (document.documentElement) document.documentElement.scrollTop = 0;
        };

        mobileTextInput.addEventListener('focus', resetScroll);
        mobileTextInput.addEventListener('blur', () => {
            resetScroll();
            setTimeout(autoscale, 120);
        });

        window.addEventListener('scroll', () => {
            if (document.activeElement === mobileTextInput) {
                resetScroll();
            }
        }, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('scroll', () => {
                if (document.activeElement === mobileTextInput) {
                    resetScroll();
                }
            });
        }

        // Xử lý khi gõ trên bàn phím ảo điện thoại: tránh multi-tap khi gõ số
        mobileTextInput.addEventListener('input', (e) => {
            const val = mobileTextInput.value;
            if (!val) return;

            for (let i = 0; i < val.length; i++) {
                const char = val[i];
                const charCode = char.charCodeAt(0);

                // Số 0-9: gửi trực tiếp ký tự số, tránh hoàn toàn multi-tap
                if (char >= '0' && char <= '9') {
                    const numCode = 48 + parseInt(char, 10);
                    evtQueue.queueEvent({
                        kind: 'keydown',
                        code: numCode,
                        symbol: char,
                        platformCode: charCode,
                        normalizedCode: charCode,
                        isTypingKey: true,
                        ctrlKey: false,
                        shiftKey: false,
                        args: [numCode, char, false, false]
                    });
                    evtQueue.queueEvent({
                        kind: 'keyup',
                        code: numCode,
                        symbol: char,
                        platformCode: charCode,
                        normalizedCode: charCode,
                        isTypingKey: true,
                        ctrlKey: false,
                        shiftKey: false,
                        args: [numCode, char, false, false]
                    });
                } else {
                    // Chữ cái hoặc ký tự khác: gõ thẳng vào J2ME
                    evtQueue.queueEvent({
                        kind: 'keydown',
                        code: charCode,
                        symbol: char,
                        platformCode: charCode,
                        normalizedCode: charCode,
                        isTypingKey: true,
                        ctrlKey: false,
                        shiftKey: false,
                        args: [charCode, char, false, false]
                    });
                    evtQueue.queueEvent({
                        kind: 'keyup',
                        code: charCode,
                        symbol: char,
                        platformCode: charCode,
                        normalizedCode: charCode,
                        isTypingKey: true,
                        ctrlKey: false,
                        shiftKey: false,
                        args: [charCode, char, false, false]
                    });
                }
            }
            mobileTextInput.value = '';
        });

        mobileTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') {
                evtQueue.queueEvent({
                    kind: 'keydown',
                    code: 8,
                    symbol: '\x08',
                    platformCode: -8,
                    normalizedCode: -8,
                    isTypingKey: true,
                    ctrlKey: false,
                    shiftKey: false,
                    args: [8, '\x08', false, false]
                });
                evtQueue.queueEvent({
                    kind: 'keyup',
                    code: 8,
                    symbol: '\x08',
                    platformCode: -8,
                    normalizedCode: -8,
                    isTypingKey: true,
                    ctrlKey: false,
                    shiftKey: false,
                    args: [8, '\x08', false, false]
                });
            } else if (e.key === 'Enter') {
                evtQueue.queueEvent({
                    kind: 'keydown',
                    code: 13,
                    symbol: '\x00',
                    platformCode: -5,
                    normalizedCode: -5,
                    ctrlKey: false,
                    shiftKey: false,
                    args: [13, '\x00', false, false]
                });
                evtQueue.queueEvent({
                    kind: 'keyup',
                    code: 13,
                    symbol: '\x00',
                    platformCode: -5,
                    normalizedCode: -5,
                    ctrlKey: false,
                    shiftKey: false,
                    args: [13, '\x00', false, false]
                });
                mobileTextInput.blur();
                if (display) display.focus();
            }
        });
    }

    // Ensure all toolbar buttons yield focus back to game display immediately
    document.querySelectorAll('.tb-btn, #btn-toggle-toolbar').forEach(btn => {
        btn.addEventListener('focus', () => {
            btn.blur();
            if (display) display.focus();
        });
        btn.addEventListener('mouseup', () => {
            btn.blur();
            if (display) display.focus();
        });
    });

    // CRT Filter Toggle
    if (btnCrt) {
        btnCrt.onclick = () => {
            document.body.classList.toggle('crt-enabled');
            btnCrt.style.borderColor = document.body.classList.contains('crt-enabled') ? 'var(--accent-cyan)' : '';
        };
    }

    // Audio Mute/Unmute
    let isMuted = false;
    if (btnMute) {
        btnMute.onclick = () => {
            isMuted = !isMuted;
            if (window.libmidi && window.libmidi.context) {
                if (isMuted) window.libmidi.context.suspend();
                else window.libmidi.context.resume();
            }
            btnMute.textContent = isMuted ? '🔇' : '🔊';
        };
    }

    // Game Library Drawer / Modal
    const gamesModal = document.getElementById('modal-games');
    const gamesListEl = document.getElementById('games-list');

    async function renderGamesModal() {
        if (!gamesListEl) return;
        gamesListEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">Đang tải danh sách game...</div>';
        const currentApp = sp.get('app') || localStorage.getItem('j2me_last_played_app') || '';
        const games = await getInstalledGames();
        gamesListEl.innerHTML = '';

        if (games.length === 0) {
            gamesListEl.innerHTML = '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:16px;">Chưa có trò chơi nào. Hãy nạp file .JAR để chơi!</div>';
            return;
        }

        games.forEach(g => {
            const isCurrent = g.appId === currentApp;
            const card = document.createElement('div');
            card.className = 'game-card' + (isCurrent ? ' current' : '');
            card.innerHTML = `
                <div class="game-card-left">
                    <img class="game-icon-img" src="${g.icon || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'36\' fill=\'%2300f2fe\' viewBox=\'0 0 16 16\'><path d=\'M11.5 6.027a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm-1.5 1.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zm2.5-.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm-1.5 1.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.5 4.5v1.2a.3.3 0 0 1-.3.3H7a.3.3 0 0 1-.3-.3V4.5a.5.5 0 0 1 1 0z\'/></svg>'}" alt="Icon" />
                    <div>
                        <div class="game-card-name">${g.name}</div>
                        <div class="game-card-badge">${isCurrent ? '● ĐANG CHƠI' : 'MIDlet'}</div>
                    </div>
                </div>
                <div class="game-card-actions">
                    <button class="tb-btn ${isCurrent ? 'primary' : ''} btn-action-play" title="Chơi trò này">${isCurrent ? 'Đang chơi' : 'Chơi ngay'}</button>
                    <button class="tb-btn btn-clear-rms" title="Xóa bộ nhớ đệm (RMS / Save Game) của trò này">🧹 Xóa đệm</button>
                    <button class="tb-btn btn-delete-app" title="Gỡ cài đặt trò chơi này">🗑️ Gỡ</button>
                </div>
            `;

            // Chơi ngay
            const btnPlay = card.querySelector('.btn-action-play');
            if (btnPlay) {
                btnPlay.onclick = (e) => {
                    e.stopPropagation();
                    if (!isCurrent) {
                        localStorage.setItem('j2me_last_played_app', g.appId);
                        location.href = '?app=' + encodeURIComponent(g.appId);
                    } else {
                        gamesModal.classList.remove('show');
                    }
                };
            }

            // Xóa bộ nhớ đệm (RMS)
            const btnClear = card.querySelector('.btn-clear-rms');
            if (btnClear) {
                btnClear.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`Bạn có chắc muốn xóa toàn bộ bộ nhớ đệm (Save game / RMS / Tài khoản) của trò chơi "${g.name}" không?`)) {
                        const success = await clearAppRms(g.appId);
                        if (success) {
                            alert(`Đã xóa sạch bộ nhớ đệm của trò chơi "${g.name}"!`);
                            if (isCurrent && confirm("Trò chơi đang chạy cần khởi động lại để làm mới dữ liệu. Tải lại ngay?")) {
                                location.reload();
                            }
                        } else {
                            alert("Không thể xóa bộ nhớ đệm lúc này.");
                        }
                    }
                };
            }

            // Gỡ cài đặt game
            const btnDelete = card.querySelector('.btn-delete-app');
            if (btnDelete) {
                btnDelete.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`Bạn có chắc muốn gỡ cài đặt vĩnh viễn trò chơi "${g.name}" khỏi thiết bị không?`)) {
                        const success = await uninstallApp(g.appId);
                        if (success) {
                            alert(`Đã gỡ cài đặt "${g.name}" thành công!`);
                            if (isCurrent) {
                                location.href = location.pathname;
                            } else {
                                renderGamesModal();
                            }
                        } else {
                            alert("Không thể gỡ cài đặt trò chơi lúc này.");
                        }
                    }
                };
            }

            card.onclick = () => {
                if (!isCurrent) {
                    localStorage.setItem('j2me_last_played_app', g.appId);
                    location.href = '?app=' + encodeURIComponent(g.appId);
                } else {
                    gamesModal.classList.remove('show');
                }
            };

            gamesListEl.appendChild(card);
        });
    }

    if (btnGamesModal && gamesModal) {
        btnGamesModal.onclick = () => {
            gamesModal.classList.add('show');
            renderGamesModal();
        };
    }

    // Help Modal
    const helpModal = document.getElementById('modal-help');
    if (btnHelpModal && helpModal) {
        btnHelpModal.onclick = () => helpModal.classList.add('show');
    }

    // Close buttons for modals
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.onclick = () => {
            const modal = btn.closest('.modal-overlay');
            if (modal) modal.classList.remove('show');
        };
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.classList.remove('show');
        };
    });
}

// ============================================================================
// Core Initialization Function
// ============================================================================
async function init() {
    const loadingText = document.getElementById("loading-text");
    if (loadingText) loadingText.textContent = "Đang khởi tạo WebAssembly JVM (CheerpJ)...";

    display = document.getElementById('display');
    screenCtx = display.getContext('2d');

    setListeners();
    initUIControls();

    // Initialize Web Audio & MIDI synthesizer
    window.libmidi = new LibMidi(createUnlockingAudioContext());
    await window.libmidi.init();
    window.libmidi.midiPlayer.addEventListener('end-of-media', e => {
        window.evtQueue.queueEvent({ kind: 'player-eom', player: e.target });
    });
    window.libmedia = new LibMedia();

    // Initialize CheerpJ WebAssembly Runtime
    await cheerpjInit({
        enableDebug: false,
        natives: {
            ...canvasFontNatives,
            ...canvasGraphicsNatives,
            ...gles2Natives,
            ...jsReferenceNatives,
            ...mediaBridgeNatives,
            ...midiBridgeNatives,
            ...socketBridgeNatives,
            ...httpBridgeNatives,
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setTitle(lib, title) {
                document.title = title + " - J2ME Web Emulator";
                const titleEl = document.getElementById('current-game-title');
                if (titleEl) titleEl.textContent = title;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setIcon(lib, iconBytes) {
                if (iconBytes) {
                    setFaviconFromBuffer(iconBytes.buffer);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_getScreenCtx(lib) {
                return screenCtx;
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_setCanvasSize(lib, width, height) {
                const indicator = document.getElementById('loading-indicator');
                if (indicator) indicator.style.display = 'none';
                display.style.display = 'block';
                scaleSet = true;
                display.focus();

                screenCtx.canvas.width = width;
                screenCtx.canvas.height = height;
                autoscale();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_waitForAndDispatchEvents(lib, listener) {
                const KeyEvent = await lib.pl.zb3.freej2me.bridge.shell.KeyEvent;
                const PointerEvent = await lib.pl.zb3.freej2me.bridge.shell.PointerEvent;

                const evt = await evtQueue.waitForEvent();
                if (evt.kind === 'keydown') {
                    const code = evt.code !== undefined ? evt.code : evt.args[0];
                    const symbol = evt.symbol !== undefined ? evt.symbol : evt.args[1];
                    const ctrl = evt.ctrlKey !== undefined ? evt.ctrlKey : (evt.args ? evt.args[2] : false);
                    const shift = evt.shiftKey !== undefined ? evt.shiftKey : (evt.args ? evt.args[3] : false);

                    const keyEvt = await new KeyEvent(code, symbol, ctrl, shift);

                    if (evt.isTypingKey && evt.platformCode !== undefined) {
                        // Direct QWERTY typing & Backspace: bypass Mobile.getMobileKey overriding typing keys
                        keyEvt.platformCode = evt.platformCode;
                        keyEvt.normalizedCode = evt.normalizedCode !== undefined ? evt.normalizedCode : evt.platformCode;

                        const Mobile = await lib.org.recompile.mobile.Mobile;
                        const platform = await Mobile.getPlatform();
                        await platform.keyPressed(keyEvt);

                        // Fallback: Chèn ký tự space cho TextBox/TextField nếu engine lọc keyChar <= 32
                        if (symbol === ' ') {
                            try {
                                const display = await Mobile.getDisplay();
                                const current = display ? await display.getCurrent() : null;
                                if (current && typeof current.insert === 'function' && typeof current.getCaretPosition === 'function') {
                                    const pos = await current.getCaretPosition();
                                    await current.insert(" ", pos);
                                }
                            } catch (_) {}
                        }
                    } else {
                        await listener.keyPressed(keyEvt);
                    }
                } else if (evt.kind === 'keyup') {
                    const code = evt.code !== undefined ? evt.code : evt.args[0];
                    const symbol = evt.symbol !== undefined ? evt.symbol : evt.args[1];
                    const ctrl = evt.ctrlKey !== undefined ? evt.ctrlKey : (evt.args ? evt.args[2] : false);
                    const shift = evt.shiftKey !== undefined ? evt.shiftKey : (evt.args ? evt.args[3] : false);

                    const keyEvt = await new KeyEvent(code, symbol, ctrl, shift);

                    if (evt.isTypingKey && evt.platformCode !== undefined) {
                        keyEvt.platformCode = evt.platformCode;
                        keyEvt.normalizedCode = evt.normalizedCode !== undefined ? evt.normalizedCode : evt.platformCode;

                        const Mobile = await lib.org.recompile.mobile.Mobile;
                        const platform = await Mobile.getPlatform();
                        await platform.keyReleased(keyEvt);
                    } else {
                        await listener.keyReleased(keyEvt);
                    }
                } else if (evt.kind === 'pointerpressed') {
                    await listener.pointerPressed(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind === 'pointerdragged') {
                    await listener.pointerDragged(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind === 'pointerreleased') {
                    await listener.pointerReleased(await new PointerEvent(evt.x, evt.y));
                } else if (evt.kind === 'player-eom') {
                    await listener.playerEOM(evt.player);
                } else if (evt.kind === 'player-video-frame') {
                    await listener.playerVideoFrame(evt.player);
                }
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_restart() {
                location.reload();
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_exit() {
                location.href = './';
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sthop() {},
            async Java_pl_zb3_freej2me_bridge_shell_Shell_say(lib, sth) {
                console.log('[FreeJ2ME]', sth);
            },
            async Java_pl_zb3_freej2me_bridge_shell_Shell_sayObject(lib, label, obj) {
                console.log('[FreeJ2ME]', label, obj);
            }
        }
    });

    if (loadingText) loadingText.textContent = "Đang nạp lõi giả lập J2ME...";

    globalLib = await cheerpjRunLibrary(cheerpjWebRoot + "/freej2me-web.jar");
    const FreeJ2ME = await globalLib.org.recompile.freej2me.FreeJ2ME;

    // Xác định ứng dụng cần khởi chạy (Query param -> LocalStorage persistence -> Empty State)
    let appId = sp.get('app');
    const isJarParam = Boolean(sp.get('jar'));

    if (!appId && !isJarParam) {
        const lastApp = localStorage.getItem('j2me_last_played_app');
        if (lastApp) {
            appId = lastApp;
            history.replaceState(null, '', '?app=' + encodeURIComponent(appId));
        }
    }

    const emptyScreen = document.getElementById('empty-state-screen');
    const loadingIndicator = document.getElementById('loading-indicator');
    const btnStopGame = document.getElementById('btn-stop-game');
    const titleEl = document.getElementById('current-game-title');

    // Nếu không có game nào (truy cập lần đầu hoặc vừa bấm đổi game)
    if (!appId && !isJarParam) {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (emptyScreen) emptyScreen.style.display = 'flex';
        if (btnStopGame) btnStopGame.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Chưa chọn game';
        document.title = 'J2ME Web Emulator - Sẵn sàng chơi game';

        // Tự động chuẩn bị dữ liệu init.zip ở chế độ chờ để danh sách game sẵn sàng
        ensureAppInstalled(globalLib, 'Connect4').catch(() => {});
        return;
    }

    // Có game: ẩn màn hình trống, hiện nút Đổi game
    if (emptyScreen) emptyScreen.style.display = 'none';
    if (btnStopGame) btnStopGame.style.display = 'inline-flex';

    let args;
    if (appId) {
        currentRunningAppId = appId;
        localStorage.setItem('j2me_last_played_app', appId);
        if (loadingText) loadingText.textContent = "Đang nạp dữ liệu game: " + appId + "...";
        await ensureAppInstalled(globalLib, appId);
        args = ['app', appId];
    } else {
        const jarName = sp.get('jar') || "game.jar";
        args = ['jar', cheerpjWebRoot + "/jar/" + jarName];
    }

    FreeJ2ME.main(args).catch(e => {
        console.error("FreeJ2ME Crash:", e);
        if (loadingText) loadingText.textContent = "Không thể khởi động game. Vui lòng thử lại!";
    });
}

init();