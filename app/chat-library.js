(() => {
    let reference, gesture, tapTimer, lastTap, suppressedUntil = 0;
    const call = (name,...args) => reference?.invokeMethodAsync(name,...args).catch(() => {});
    function clearTargets() { document.querySelectorAll('.is-drop,.is-before').forEach(node => node.classList.remove('is-drop','is-before')); }
    function targetAt(x,y) {
        const element=document.elementFromPoint(x,y);
        const target=element?.closest('[data-chat-drop]');
        if(!target || !target.closest('.conversation-drawer'))return null;
        const section=target.closest('.chat-section');
        const row=target.matches('.chat-item') ? target : null;
        const before=row && y < row.getBoundingClientRect().top+row.offsetHeight/2 ? row : row?.nextElementSibling?.matches('.chat-item') ? row.nextElementSibling : null;
        return {section,target:target.dataset.chatDrop,before:before?.dataset.chatId??null,row:before};
    }
    function finish(event,cancel) {
        const active=gesture;
        if(!active || event.pointerId!==active.pointerId)return;
        gesture=null; clearTimeout(active.timer); clearTargets();
        active.row.classList.remove('is-held');
        if(active.row.hasPointerCapture(active.pointerId))active.row.releasePointerCapture(active.pointerId);
        if(active.ghost) {
            const target=cancel ? null : targetAt(event.clientX,event.clientY);
            const returnHome=()=> {
                const rect=active.row.getBoundingClientRect();
                active.ghost.style.transition='left .26s cubic-bezier(.2,.8,.2,1),top .26s cubic-bezier(.2,.8,.2,1),opacity .26s';
                active.ghost.style.left=rect.left+'px'; active.ghost.style.top=rect.top+'px'; active.ghost.style.opacity='0';
                setTimeout(()=> {active.ghost.remove();active.row.classList.remove('is-source');},270);
            };
            if(target) Promise.resolve(call('ChatDrop',active.id,target.target,target.before)).finally(returnHome);
            else returnHome();
        } else if(active.held && !cancel) call('ChatHeld',active.id,active.group);
        else if(!cancel && !active.moved) {
            const twice=lastTap?.id===active.id && performance.now()-lastTap.at<300;
            clearTimeout(tapTimer);
            if(twice) { lastTap=null;call('ChatTap',active.id,true,active.group); }
            else { lastTap={id:active.id,at:performance.now()};tapTimer=setTimeout(()=> {lastTap=null;call('ChatTap',active.id,false,active.group);},300); }
        }
        suppressedUntil=performance.now()+700;
    }
    window.timbreuseMobile.chatDrawer = value => {
        clearTimeout(tapTimer);lastTap=null;
        if(gesture) { clearTimeout(gesture.timer);gesture.ghost?.remove();gesture.row.classList.remove('is-held','is-source');gesture=null; }
        clearTargets();reference=value;
    };
    document.addEventListener('pointerdown',event=> {
        const row=event.target.closest?.('[data-chat-id],[data-chat-group]');
        if(!reference || !row || row.disabled || !event.isPrimary || event.button!==0 || gesture)return;
        const active=gesture={row,id:row.dataset.chatId??row.dataset.chatGroup,group:!!row.dataset.chatGroup,pointerId:event.pointerId,x:event.clientX,y:event.clientY,held:false,moved:false};
        active.timer=setTimeout(()=> { if(gesture!==active)return;active.held=true;row.classList.add('is-held');row.setPointerCapture(event.pointerId); },380);
    });
    document.addEventListener('touchmove',event=> { if(gesture?.held)event.preventDefault(); },{passive:false});
    document.addEventListener('pointermove',event=> {
        const active=gesture;if(!active || active.pointerId!==event.pointerId)return;
        const distance=Math.hypot(event.clientX-active.x,event.clientY-active.y);
        if(!active.held) { if(distance>8) {active.moved=true;clearTimeout(active.timer);}return; }
        event.preventDefault();
        if(active.group)return;
        if(!active.ghost && distance>8) {
            const rect=active.row.getBoundingClientRect();active.ghost=active.row.cloneNode(true);
            active.ghost.removeAttribute('data-chat-id');active.ghost.removeAttribute('data-chat-drop');active.ghost.removeAttribute('aria-current');active.ghost.setAttribute('aria-hidden','true');
            active.ghost.classList.remove('is-held','selected');active.ghost.classList.add('chat-ghost');active.ghost.style.width=rect.width+'px';
            active.offsetX=active.x-rect.left;active.offsetY=active.y-rect.top;
            document.body.append(active.ghost);active.row.classList.add('is-source');
        }
        if(!active.ghost)return;
        active.ghost.style.left=(event.clientX-active.offsetX)+'px';active.ghost.style.top=(event.clientY-active.offsetY)+'px';
        clearTargets();const target=targetAt(event.clientX,event.clientY);target?.section?.classList.add('is-drop');target?.row?.classList.add('is-before');
        const list=document.querySelector('.chat-library');
        if(list) {const rect=list.getBoundingClientRect();if(event.clientY<rect.top+40)list.scrollTop-=12;else if(event.clientY>rect.bottom-40)list.scrollTop+=12;}
    },{passive:false});
    document.addEventListener('pointerup',event=>finish(event,false));
    document.addEventListener('pointercancel',event=>finish(event,true));
    document.addEventListener('lostpointercapture',event=>finish(event,true));
    document.addEventListener('click',event=> {
        if(event.detail!==0 && event.target.closest?.('[data-chat-id],[data-chat-group]') && performance.now()<suppressedUntil) {event.preventDefault();event.stopPropagation();}
    },true);
    document.addEventListener('dblclick',event=> {if(event.target.closest?.('[data-chat-id],[data-chat-group]')) {event.preventDefault();event.stopPropagation();}},true);
})();
