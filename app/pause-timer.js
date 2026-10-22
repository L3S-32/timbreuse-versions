// Local reminder only, never a pointage writer. Browsers may suspend timers in the
// background: always compare the absolute deadline, never decrement a counter.
(() => {
    let activeKey = '', deadline = 0, reminderAt = 0, wakeup, sending = false, delivered = '';
    const storageKey = 'seganTime.pause-reminder.delivered';
    try { delivered = localStorage.getItem(storageKey) || ''; } catch { }

    async function notify() {
        const key = activeKey;
        if (!key || Date.now() < reminderAt || key === delivered || sending
            || globalThis.Notification?.permission !== 'granted') return;
        sending = true;
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration || activeKey !== key) return;
            const remaining=Math.max(0,Math.ceil((deadline-Date.now())/60000));
            await registration.showNotification(remaining>0 ? 'Ta pause se termine bientôt' : 'Ta pause est terminée', {
                body: remaining>0 ? `Il reste environ ${remaining} min de pause. Pense à pointer ta reprise lorsque tu recommences.`
                    : 'Le minuteur de pause est arrivé à zéro. Pense à pointer ta reprise lorsque tu recommences.',
                tag: 'seganTime-pause-' + key,
                icon: new URL('brand.png', registration.scope).href,
                data: { url: registration.scope }
            });
            delivered = key;
            try { localStorage.setItem(storageKey, key); } catch { }
        } catch { /* An OS refusal must not break the countdown or pointage. */ }
        finally { sending = false; }
    }
    function check() {
        clearTimeout(wakeup);
        if (!activeKey) return;
        const remaining = reminderAt - Date.now();
        if (remaining <= 0) { void notify(); return; }
        wakeup = setTimeout(check, Math.min(remaining, 60000));
    }
    function set(key, endsUtc, enabled = false, leadMinutes = 5) {
        activeKey = enabled === true && typeof key === 'string' && Number.isFinite(endsUtc) ? key : '';
        deadline = endsUtc || 0;
        reminderAt = deadline - Math.max(0,Math.min(30,Number.isFinite(leadMinutes)?leadMinutes:5))*60000;
        check();
    }
    async function enable() {
        if (!globalThis.Notification || !navigator.serviceWorker)
            return 'Les notifications ne sont pas disponibles ici. Sur iPhone, ouvre seganTime depuis son icône ajoutée à l’écran d’accueil.';
        try {
            // Called only by the person's explicit button click, never on startup.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return 'Notifications non autorisées. Le compte à rebours reste disponible dans seganTime.';
            check();
            return 'Rappel autorisé. Écran verrouillé ou application fermée, il peut être retardé par le navigateur.';
        } catch { return 'Ce navigateur ne permet pas d’activer l’alerte ici. Le compte à rebours reste disponible.'; }
    }
    document.addEventListener('visibilitychange', check);
    globalThis.seganPause = { set, enable, permission:()=>globalThis.Notification?.permission??'unsupported' };
})();
