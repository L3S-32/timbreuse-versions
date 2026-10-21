// seganTime: the phone side of the sealed box (owner, 19 October). Same derivation as the PC's SyncBox.cs:
// PBKDF2-SHA256(code, "seganTime-sync-v1", 150000) → 64 bytes; box address = SHA-256("box:" + bytes)[0..16] in hex;
// key = the first 32 bytes (AES-256-GCM, associated data "seganTime-sync-v1|" + address). The code never leaves the
// phone: only the address goes to the relay, and only ciphertext comes back.
(() => {
    const salt = 'seganTime-sync-v1';
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const encoder = new TextEncoder();
    const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

    function normalize(typed) {
        if (typeof typed !== 'string') return null;
        let text = '';
        for (const raw of typed.toUpperCase()) {
            if (raw === '-' || raw === ' ' || raw === ' ') continue;
            const character = raw === 'O' ? '0' : raw === 'I' || raw === 'L' ? '1' : raw;
            if (!alphabet.includes(character)) return null;
            text += character;
        }
        return text.length === 16 ? text : null;
    }

    let cachedCode, cachedKeys;
    async function derive(normalized) {
        if(cachedCode===normalized && cachedKeys) return cachedKeys;
        const material = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, ['deriveBits']);
        const master = new Uint8Array(await crypto.subtle.deriveBits(
            { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 150000 }, material, 512));
        const labelled = async label => hex(await crypto.subtle.digest('SHA-256', new Uint8Array([...encoder.encode(label), ...master])));
        const boxId = (await labelled('box:')).slice(0, 32);
        const key = await crypto.subtle.importKey('raw', master.slice(0, 32), 'AES-GCM', false, ['encrypt','decrypt']);
        cachedKeys={ boxId, key, writeProof: await labelled('write:') };cachedCode=normalized;
        return cachedKeys;
    }

    function fromBase64(text) {
        const binary = atob(text);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    }

    // Bound the complete exchange, including its body: a sleeping PC or a broken mobile
    // connection must never leave the controls stuck on « Synchronisation… ».
    async function exchange(fetcher, url, options, read) {
        if (typeof globalThis.AbortController !== 'function' || typeof globalThis.setTimeout !== 'function')
            return read(await fetcher(url, options));
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                (async () => read(await fetcher(url, { ...options, signal: controller.signal })))(),
                new Promise((_, reject) => { timer = setTimeout(() => {
                    controller.abort(); reject(new Error('Délai de synchronisation dépassé.'));
                }, 20000); })
            ]);
        } finally { clearTimeout(timer); }
    }

    async function open(keys, envelopeText) {
        const envelope = JSON.parse(envelopeText);
        if (!envelope || envelope.v !== 1) throw new Error('Version de boîte inconnue.');
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64(envelope.nonce), additionalData: encoder.encode(salt + '|' + keys.boxId), tagLength: 128 },
            keys.key, fromBase64(envelope.data));
        return new TextDecoder().decode(plain);
    }

    /// Returns { status: 'ok', json, updated } or { status: 'invalid-code' | 'empty' | 'wrong-code' | 'offline' | 'error' }.
    async function fetchBox(relayUrl, typedCode, fetcher = fetch) {
        const code = normalize(typedCode);
        if (!code) return { status: 'invalid-code' };
        const keys = await derive(code);
        try {
            const base = new URL(relayUrl);
            if (base.protocol !== 'https:' && !['127.0.0.1','localhost','[::1]'].includes(base.hostname)) return { status: 'error' };
            return await exchange(fetcher, relayUrl.replace(/\/+$/, '') + '/v1/box/' + keys.boxId, { cache: 'no-store' }, async response => {
                if (response.status === 404) return { status: 'empty' };
                if (!response.ok) return { status: 'error', code: response.status };
                const envelope = await response.text();
                try { return { status: 'ok', json: await open(keys, envelope), updated: response.headers.get('X-Box-Updated') }; }
                catch { return { status: 'wrong-code' }; }
            });
        } catch {
            return { status: 'offline' };
        }
    }

    async function prepareCommand(code,json) {
        const normalized=normalize(code); if(!normalized) throw new Error('Code invalide');
        const keys=await derive(normalized), nonce=crypto.getRandomValues(new Uint8Array(12));
        const data=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode(salt+'|'+keys.boxId)},keys.key,encoder.encode(json));
        const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
        return JSON.stringify({v:1,nonce:base64(nonce),data:base64(data)});
    }
    async function commandRequest(relay,code,id,envelope=null,fetcher=globalThis.fetch) {
        const normalized=normalize(code); if(!normalized || !/^[0-9a-f]{32}$/.test(id)) return {status:'invalid-code'};
        const base=new URL(relay);
        if(base.protocol!=='https:' && !['127.0.0.1','localhost','[::1]'].includes(base.hostname)) return {status:'error'};
        const keys=await derive(normalized);
        try {
            return await exchange(fetcher,base.href.replace(/\/$/,'')+'/v1/box/'+keys.boxId+'/commands/'+id,
                {method:envelope===null?'GET':'PUT',headers:{Authorization:'Bearer '+keys.writeProof,'Content-Type':'application/json'},
                    ...(envelope===null?{}:{body:envelope}),cache:'no-store'}, async response => {
            if(!response.ok) return {status:response.status===429?'capacity':response.status===409?'conflict':'error'};
            if(envelope!==null) return {status:'queued'};
            const value=await response.json();
            return value.state==='done' ? {status:'done',json:await open(keys,value.receipt)} : {status:'pending'};
            });
        } catch { return {status:'offline'}; }
    }
    globalThis.seganSync = { normalize, derive, open, fetchBox, prepareCommand, commandRequest };
})();
