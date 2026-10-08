// ============================================================================
// Virtual Keypad Touch & Mouse Manager (Unified Pointer Events)
// ============================================================================

let handleKey = null;
let isKbdDisabled = false;

export function setKbdHandler(handler) {
    handleKey = handler;
}

export function setVirtualKbdDisabled(disabled) {
    isKbdDisabled = !!disabled;
    if (isKbdDisabled) {
        document.querySelectorAll('.key.active').forEach(btn => btn.classList.remove('active'));
    }
}

export function isVirtualKbdDisabled() {
    return isKbdDisabled;
}

export function highlightKeyFromCode(code, isDown) {
    // Hoàn toàn không đồng bộ trạng thái active của phím ảo với phím vật lý
    return;
}

export function initKbdListeners() {
    const allKeys = document.querySelectorAll('.key');

    allKeys.forEach(btn => {
        const keyName = btn.dataset.key;
        if (!keyName) return;

        let isPressed = false;

        let lastVibrateTime = 0;

        const press = (e) => {
            if (isKbdDisabled) return; // Chặn hoàn toàn thao tác khi bàn phím ảo bị tắt
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (!isPressed) {
                isPressed = true;
                btn.classList.add('active');
                const now = performance.now();
                if (navigator.vibrate && now - lastVibrateTime > 60) {
                    lastVibrateTime = now;
                    try { navigator.vibrate(8); } catch (_) {}
                }
                if (handleKey) {
                    handleKey(true, keyName);
                }
            }
        };

        const release = (e) => {
            if (isKbdDisabled) return;
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (isPressed) {
                isPressed = false;
                btn.classList.remove('active');
                if (handleKey) {
                    handleKey(false, keyName);
                }
            }
        };

        // Pointer Events: Unifies Mouse, Touch & Stylus into single reliable stream
        btn.addEventListener('pointerdown', (e) => {
            if (isKbdDisabled) return;
            btn.setPointerCapture(e.pointerId);
            press(e);
        });

        btn.addEventListener('pointerup', (e) => {
            if (isKbdDisabled) return;
            try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
            release(e);
        });

        btn.addEventListener('pointercancel', (e) => {
            if (isKbdDisabled) return;
            try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
            release(e);
        });

        // Prevent context menus on long-press
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
}