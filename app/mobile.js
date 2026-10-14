(() => {
    const databaseName = 'timbreuse-companion-v1';
    let databasePromise;
    function openDatabase() {
        return databasePromise ??= new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('state');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('Le stockage local est indisponible.'));
            request.onblocked = () => reject(new Error('Ferme les autres onglets Timbreuse pour ouvrir le stockage.'));
        }).catch(error => { databasePromise = null; throw error; });
    }
    function resize(element) {
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = Math.min(element.scrollHeight, 160) + 'px';
    }
    document.addEventListener('input', event => {
        if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute('data-autogrow')) resize(event.target);
    });
    let connectivityReference;
    let composerReference;
    // The visual viewport also shrinks with the keyboard on mobile browsers
    // that do not resize their layout viewport (notably Safari).
    function updateVisibleViewport() {
        const viewport = window.visualViewport;
        if (!viewport || Math.abs(viewport.scale - 1) > .05) return;
        document.documentElement.style.setProperty('--visible-height', viewport.height + 'px');
        document.documentElement.style.setProperty('--nav-bottom', Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) + 'px');
        document.documentElement.dataset.keyboard = window.innerHeight - viewport.height > 140 ? 'open' : 'closed';
    }
    window.visualViewport?.addEventListener('resize', updateVisibleViewport);
    window.visualViewport?.addEventListener('scroll', updateVisibleViewport);
    window.addEventListener('resize', updateVisibleViewport);
    updateVisibleViewport();
    window.timbreuseMobile = {
        async load() {
            const db = await openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction('state', 'readonly');
                const request = transaction.objectStore('state').get('mobile');
                request.onsuccess = () => resolve(request.result ?? null);
                request.onerror = () => reject(new Error('Lecture locale impossible.'));
            });
        },
        async save(json, expected) {
            const db = await openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction('state', 'readwrite');
                const store = transaction.objectStore('state');
                let conflict = false;
                const request = store.get('mobile');
                request.onsuccess = () => {
                    if ((request.result ?? null) !== expected) { conflict = true; transaction.abort(); return; }
                    store.put(json, 'mobile');
                };
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(new Error('Enregistrement local impossible.'));
                transaction.onabort = () => reject(new Error(conflict
                    ? 'Un autre onglet Timbreuse a modifié les données. Recharge cette page avant de continuer ; aucune correction n’a été écrasée.'
                    : 'Enregistrement annulé : stockage plein ou indisponible.'));
            });
        },
        appearance(theme, accent, textScale) {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--accent', accent);
            const rgb = accent.slice(1).match(/../g).map(channel => parseInt(channel,16)/255);
            const linear = rgb.map(channel => channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4);
            const luminance = .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
            document.documentElement.style.setProperty('--accent-ink', luminance>.179 ? '#000000' : '#ffffff');
            document.documentElement.style.setProperty('--text-scale', textScale);
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
        },
        observe(reference) { connectivityReference = reference; },
        detach() { connectivityReference = null; composerReference = null; },
        composer(reference) { composerReference = reference; },
        scrollChat() {
            requestAnimationFrame(() => {
                const messages = document.getElementById('messages');
                if (messages) messages.scrollTop = messages.scrollHeight;
                resize(document.getElementById('composer-input'));
            });
        },
        focusComposer() { document.getElementById('composer-input')?.focus(); },
        focusDialog() { requestAnimationFrame(() => document.querySelector('[role="dialog"] [data-initial-focus]')?.focus()); },
        online() { return navigator.onLine; },
        download(name, text) {
            const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = name;
            document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };
    document.addEventListener('keydown', event => {
        if (event.target?.id === 'composer-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            composerReference?.invokeMethodAsync('SendFromKeyboard').catch(() => {});
        }
        const dialog = document.querySelector('.action-backdrop [role="dialog"]') ?? document.querySelector('[role="dialog"]');
        if (event.key !== 'Tab' || !dialog) return;
        const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(element => element.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (!dialog.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    const notify = () => connectivityReference?.invokeMethodAsync('ConnectivityChanged', navigator.onLine).catch(() => {});
    let lastDialog = null, dialogOpener = null;
    new MutationObserver(() => {
        queueNavigationLayout();
        const dialog = document.querySelector('.action-backdrop [role="dialog"]') ?? document.querySelector('[role="dialog"]');
        if (dialog === lastDialog) return;
        if (dialog) {
            dialogOpener = document.activeElement;
            requestAnimationFrame(() => dialog.querySelector('[data-initial-focus], button, input')?.focus());
        } else if (dialogOpener?.isConnected) dialogOpener.focus();
        lastDialog = dialog;
    }).observe(document.body, { childList: true, subtree: true, attributes:true, attributeFilter:['aria-current'] });
    window.addEventListener('online', notify);
    window.addEventListener('offline', notify);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) notify(); });

    // One shared indicator follows the pointer continuously, independently of
    // the button centres. It snaps to the chosen tab only after release.
    let navigationGesture = null, suppressNavigationClickUntil = 0;
    let navigationLayoutFrame = 0;
    function placeNavigationIndicator(nav, button) {
        if (!button) return;
        nav.style.setProperty('--nav-width', button.offsetWidth + 'px');
        nav.style.setProperty('--nav-x', button.offsetLeft + 'px');
    }
    function queueNavigationLayout() {
        if (navigationLayoutFrame) return;
        navigationLayoutFrame = requestAnimationFrame(() => {
            navigationLayoutFrame = 0;
            if (navigationGesture) return;
            const nav = document.querySelector('.bottom-nav');
            if (nav) placeNavigationIndicator(nav, nav.querySelector('[aria-current="page"]'));
        });
    }
    window.addEventListener('resize', queueNavigationLayout);
    queueNavigationLayout();
    function navigationTarget(x, nav) {
        const area = nav.getBoundingClientRect();
        const buttons = [...nav.querySelectorAll('button')];
        return buttons.reduce((nearest, button) => Math.abs(x - area.left - button.offsetLeft - button.offsetWidth / 2)
            < Math.abs(x - area.left - nearest.offsetLeft - nearest.offsetWidth / 2) ? button : nearest, buttons[0]);
    }
    function previewNavigation(x) {
        const gesture = navigationGesture;
        if (!gesture) return;
        const area = gesture.nav.getBoundingClientRect();
        const buttons = gesture.nav.querySelectorAll('button');
        const first = buttons[0], last = buttons[buttons.length - 1];
        const left = Math.max(first.offsetLeft, Math.min(last.offsetLeft, x - area.left - gesture.width / 2));
        gesture.nav.style.setProperty('--nav-x', left + 'px');
        // Preview follows the bubble's centre, not whether the finger is over
        // a button. Captured touches may stray above/below this horizontal rail.
        const button = navigationTarget(area.left + left + gesture.width / 2, gesture.nav);
        if (gesture.button === button) return;
        gesture.button?.classList.remove('is-pressed');
        gesture.button = button;
        button?.classList.add('is-pressed');
    }
    function endNavigation(event, commit) {
        const gesture = navigationGesture;
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        const area = gesture.nav.getBoundingClientRect();
        const withinRail = event.clientX >= area.left - 24 && event.clientX <= area.right + 24
            && event.clientY >= area.top - 56 && event.clientY <= area.bottom + 56;
        if (commit && withinRail) previewNavigation(event.clientX);
        const button = commit && withinRail ? gesture.button : null;
        gesture.button?.classList.remove('is-pressed');
        gesture.nav.classList.remove('is-tracking');
        navigationGesture = null;
        if (gesture.nav.hasPointerCapture(event.pointerId)) gesture.nav.releasePointerCapture(event.pointerId);
        placeNavigationIndicator(gesture.nav, button ?? gesture.nav.querySelector('[aria-current="page"]'));
        suppressNavigationClickUntil = performance.now() + 500;
        if (button?.isConnected) button.click();
    }
    document.addEventListener('pointerdown', event => {
        const button = event.target.closest?.('.bottom-nav button');
        if (!button || navigationGesture || !event.isPrimary || event.button !== 0) return;
        const nav = button.closest('.bottom-nav');
        navigationGesture = { nav, pointerId:event.pointerId, button:null, width:button.offsetWidth };
        nav.style.setProperty('--nav-width', button.offsetWidth + 'px');
        nav.classList.add('is-tracking');
        nav.setPointerCapture(event.pointerId);
        previewNavigation(event.clientX);
    });
    document.addEventListener('pointermove', event => {
        if (navigationGesture?.pointerId === event.pointerId)
            previewNavigation(event.clientX);
    });
    document.addEventListener('pointerup', event => endNavigation(event, true));
    document.addEventListener('pointercancel', event => endNavigation(event, false));
    document.addEventListener('lostpointercapture', event => endNavigation(event, false));
    document.addEventListener('click', event => {
        if (event.isTrusted && event.detail !== 0 && performance.now() < suppressNavigationClickUntil
            && event.target.closest?.('.bottom-nav')) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
})();
