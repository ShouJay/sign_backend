// 全域變數
let socket, eventId=null, eventMeta=null, isAdmin=false, showAll=false;
let currentZoom=1, isDragging=false, dragElement=null;
let isResizing=false, resizeHandle=null, backgroundImage=null;
const stage=document.getElementById('stage'), ctx=stage.getContext('2d');
const dragOverlay=document.getElementById('dragOverlay');

// 工具函數
function getToken(){ return localStorage.getItem('token')||''; }
function setToken(t){ localStorage.setItem('token',t); }
function clearToken(){ localStorage.removeItem('token'); }
function withAuth(init={}){ 
  const h=init.headers?new Headers(init.headers):new Headers(); 
  const t=getToken(); 
  if(t) h.set('Authorization','Bearer '+t); 
  if(!h.has('Content-Type') && init.body) h.set('Content-Type','application/json'); 
  return {...init, headers:h}; 
}
async function api(url,opt={}){ 
  try{ 
    const r=await fetch(url,withAuth(opt)); 
    let j={}; 
    try{ j=await r.json(); }catch{} 
    return {r,j}; 
  }catch(e){ 
    return {r:{ok:false,status:0}, j:{error:String(e)}}; 
  } 
}

// 認證相關
function showAuthMask(on){ document.getElementById('authMask').hidden=!on; }

async function requireLogin(){
  if(!getToken()){ showAuthMask(true); return false; }
  const {r,j}=await api('/api/me');
  if(!r.ok){ showAuthMask(true); return false; }
  isAdmin = j.role==='admin';
  document.getElementById('who').innerHTML = `${j.email}${isAdmin?'<span class="adminBadge">管理者</span>':''}`;
  document.getElementById('adminOps').hidden = !isAdmin;
  return true;
}

// 通知系統
function showNotification(message, type='info'){
  const notification=document.createElement('div');
  notification.style.cssText=`
    position:fixed;top:20px;right:20px;z-index:10000;
    padding:16px 20px;border-radius:12px;color:white;font-weight:500;
    box-shadow:0 8px 25px rgba(0,0,0,0.15);animation:slideInRight 0.3s ease;
    max-width:400px;word-wrap:break-word;
  `;
  
  const colors={
    success:'#10b981', info:'#3b82f6', warning:'#f59e0b', error:'#ef4444'
  };
  notification.style.background=colors[type]||colors.info;
  notification.textContent=message;
  
  document.body.appendChild(notification);
  setTimeout(()=>{
    notification.style.animation='slideOutRight 0.3s ease';
    setTimeout(()=>notification.remove(), 300);
  }, 3000);
}

// 畫布相關
function resetCanvasUI(){ 
  eventInfo.textContent='尚未選擇房間'; 
  qrA.innerHTML=''; 
  qrB.innerHTML=''; 
  ctx.clearRect(0,0,stage.width,stage.height); 
  backgroundImage=null;
}

async function fetchEvent(id){ 
  const r=await fetch(`/api/event/${id}`); 
  if(!r.ok) throw new Error('not found'); 
  return await r.json(); 
}

function drawSlots(){
  ctx.clearRect(0,0,stage.width,stage.height);
  
  // 繪製背景圖片
  if(backgroundImage){
    ctx.drawImage(backgroundImage, 0, 0, stage.width, stage.height);
  }
  
  ctx.save(); 
  ctx.strokeStyle='#3b82f6'; 
  ctx.lineWidth=3; 
  ctx.font='bold 16px Inter, system-ui'; 
  ctx.fillStyle='#1e40af';
  
  const A=eventMeta.slots.A, B=eventMeta.slots.B;
  
  // 繪製甲方區域
  A.forEach((s,i)=>{
    ctx.fillStyle='rgba(59, 130, 246, 0.1)';
    ctx.fillRect(s.x,s.y,s.w,s.h);
    ctx.strokeStyle='#3b82f6';
    ctx.strokeRect(s.x,s.y,s.w,s.h);
    ctx.fillStyle='#1e40af';
    ctx.fillText(`👤 甲方 A-${i+1}`, s.x+12, s.y+24);
  });
  
  // 繪製乙方區域
  B.forEach((s,i)=>{
    ctx.fillStyle='rgba(16, 185, 129, 0.1)';
    ctx.fillRect(s.x,s.y,s.w,s.h);
    ctx.strokeStyle='#10b981';
    ctx.strokeRect(s.x,s.y,s.w,s.h);
    ctx.fillStyle='#047857';
    ctx.fillText(`👥 乙方 B-${i+1}`, s.x+12, s.y+24);
  });
  
  ctx.restore();
  
  // 重新繪製所有現有的簽名
  A.forEach((s,i)=>{
    if(s.signatureData) {
      redrawSignature('A', i, s.signatureData);
    }
  });
  
  B.forEach((s,i)=>{
    if(s.signatureData) {
      redrawSignature('B', i, s.signatureData);
    }
  });
  
  updateDragOverlay();
}

// 更新拖拽覆蓋層
function updateDragOverlay(){
  if(!eventMeta) return;
  
  dragOverlay.innerHTML='';
  dragOverlay.style.pointerEvents='auto';
  
  const A=eventMeta.slots.A, B=eventMeta.slots.B;
  
  A.forEach((s,i)=>{
    const div=document.createElement('div');
    div.className='draggable-slot';
    div.style.left=s.x+'px';
    div.style.top=s.y+'px';
    div.style.width=s.w+'px';
    div.style.height=s.h+'px';
    div.dataset.side='A';
    div.dataset.index=i;
    div.innerHTML=`
      <div style="position:absolute;top:4px;left:4px;font-size:12px;color:#1e40af;font-weight:bold;">甲方 A-${i+1}</div>
      <div class="resize-handle se" data-side="A" data-index="${i}" data-handle="se"></div>
      <div class="resize-handle sw" data-side="A" data-index="${i}" data-handle="sw"></div>
      <div class="resize-handle ne" data-side="A" data-index="${i}" data-handle="ne"></div>
      <div class="resize-handle nw" data-side="A" data-index="${i}" data-handle="nw"></div>
    `;
    dragOverlay.appendChild(div);
  });
  
  B.forEach((s,i)=>{
    const div=document.createElement('div');
    div.className='draggable-slot';
    div.style.left=s.x+'px';
    div.style.top=s.y+'px';
    div.style.width=s.w+'px';
    div.style.height=s.h+'px';
    div.dataset.side='B';
    div.dataset.index=i;
    div.innerHTML=`
      <div style="position:absolute;top:4px;left:4px;font-size:12px;color:#047857;font-weight:bold;">乙方 B-${i+1}</div>
      <div class="resize-handle se" data-side="B" data-index="${i}" data-handle="se"></div>
      <div class="resize-handle sw" data-side="B" data-index="${i}" data-handle="sw"></div>
      <div class="resize-handle ne" data-side="B" data-index="${i}" data-handle="ne"></div>
      <div class="resize-handle nw" data-side="B" data-index="${i}" data-handle="nw"></div>
    `;
    dragOverlay.appendChild(div);
  });
}

// 智能自動排版
function smartLayout(countA, countB, stageWidth, stageHeight){
  const PAD=20, GAP=16, GAP_ROW=20, BOT=20;
  const minHeight=Math.max(120, Math.round(stageHeight*0.15));
  const maxHeight=Math.round(stageHeight*0.25);
  
  // 計算最佳行高
  const availableHeight=stageHeight-BOT-GAP_ROW;
  const rowHeight=Math.min(maxHeight, Math.max(minHeight, Math.floor(availableHeight/2)));
  
  // 甲方在上方，乙方在下方
  const yA=Math.round((stageHeight-rowHeight*2-GAP_ROW)/2);
  const yB=yA+rowHeight+GAP_ROW;
  
  const layoutRow=(count, y)=>{
    if(count<=0) return [];
    const totalGap=(count-1)*GAP;
    const totalWidth=stageWidth-PAD*2-totalGap;
    const width=Math.floor(totalWidth/count);
    const startX=PAD;
    
    return Array.from({length:count}, (_,i)=>({
      x: startX+i*(width+GAP),
      y: y,
      w: width,
      h: rowHeight
    }));
  };
  
  return {
    A: layoutRow(countA, yA),
    B: layoutRow(countB, yB)
  };
}

function getBase(){ return location.origin.replace(/\/+$/,''); }

// QR 碼渲染
function renderQRCodes(){
  const base=getBase()+`/signer.html?eventId=${encodeURIComponent(eventId)}`;
  const aBox=document.getElementById('qrA');
  const bBox=document.getElementById('qrB');
  aBox.innerHTML=''; bBox.innerHTML='';

  const makeCard=(label,url)=>{
    const wrap=document.createElement('div'); wrap.className='qrCard';
    const cap=document.createElement('div'); cap.className='cap'; cap.textContent=label;
    const c=document.createElement('canvas'); c.width=160; c.height=160;
    wrap.appendChild(cap); wrap.appendChild(c);
    QRCode.toCanvas(c,url);
    return wrap;
  };

  (eventMeta.slots.A||[]).forEach((_,i)=>{
    aBox.appendChild(makeCard(`甲方 A-${i+1}`, `${base}&slot=A&idx=${i}`));
  });
  (eventMeta.slots.B||[]).forEach((_,i)=>{
    bBox.appendChild(makeCard(`乙方 B-${i+1}`, `${base}&slot=B&idx=${i}`));
  });
}

// 背景圖片處理
function loadBackgroundImage(file){
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      backgroundImage=img;
      drawSlots();
      
      // 更新預覽
      const preview=document.getElementById('backgroundPreview');
      preview.style.backgroundImage=`url(${e.target.result})`;
      
      showNotification('✅ 背景圖片已載入', 'success');
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearBackgroundImage(){
  backgroundImage=null;
  drawSlots();
  
  // 清除預覽
  const preview=document.getElementById('backgroundPreview');
  preview.style.backgroundImage='none';
  
  showNotification('🗑️ 背景圖片已清除', 'info');
}

// 重新繪製簽名
function redrawSignature(side, index, signatureData){
  if(!signatureData || !eventMeta) return;
  
  const slot = eventMeta.slots[side][index];
  if(!slot) return;
  
  ctx.save();
  
  // 計算縮放比例
  const scaleX = slot.w / signatureData.originalWidth;
  const scaleY = slot.h / signatureData.originalHeight;
  
  // 繪製每筆簽名
  signatureData.strokes.forEach(stroke => {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size * Math.max(scaleX, scaleY);
    ctx.beginPath();
    
    if(stroke.points && stroke.points.length > 0) {
      const firstPoint = stroke.points[0];
      ctx.moveTo(slot.x + firstPoint[0] * scaleX, slot.y + firstPoint[1] * scaleY);
      
      for(let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        ctx.lineTo(slot.x + point[0] * scaleX, slot.y + point[1] * scaleY);
      }
    }
    
    ctx.stroke();
  });
  
  ctx.restore();
}

// 拖拽和調整大小功能
function initDragAndDrop(){
  dragOverlay.addEventListener('mousedown', (e)=>{
    
    const target=e.target.closest('.draggable-slot');
    const handle=e.target.closest('.resize-handle');
    
    if(handle){
      // 調整大小
      e.preventDefault();
      isResizing=true;
      resizeHandle=handle;
      
      const rect=stage.getBoundingClientRect();
      const startX=e.clientX-rect.left;
      const startY=e.clientY-rect.top;
      
      const slot=handle.closest('.draggable-slot');
      const startLeft=parseInt(slot.style.left);
      const startTop=parseInt(slot.style.top);
      const startWidth=parseInt(slot.style.width);
      const startHeight=parseInt(slot.style.height);
      
      const onMouseMove=(e)=>{
        if(!isResizing) return;
        const deltaX=e.clientX-rect.left-startX;
        const deltaY=e.clientY-rect.top-startY;
        
        let newX=startLeft, newY=startTop, newW=startWidth, newH=startHeight;
        
        switch(handle.dataset.handle){
          case 'se':
            newW=Math.max(50, startWidth+deltaX);
            newH=Math.max(50, startHeight+deltaY);
            break;
          case 'sw':
            newX=Math.max(0, startLeft+deltaX);
            newW=Math.max(50, startWidth-deltaX);
            newH=Math.max(50, startHeight+deltaY);
            break;
          case 'ne':
            newY=Math.max(0, startTop+deltaY);
            newW=Math.max(50, startWidth+deltaX);
            newH=Math.max(50, startHeight-deltaY);
            break;
          case 'nw':
            newX=Math.max(0, startLeft+deltaX);
            newY=Math.max(0, startTop+deltaY);
            newW=Math.max(50, startWidth-deltaX);
            newH=Math.max(50, startHeight-deltaY);
            break;
        }
        
        slot.style.left=newX+'px';
        slot.style.top=newY+'px';
        slot.style.width=newW+'px';
        slot.style.height=newH+'px';
      };
      
      const onMouseUp=async ()=>{
        if(!isResizing) return;
        isResizing=false;
        
        const side=slot.dataset.side;
        const index=parseInt(slot.dataset.index);
        const newX=parseInt(slot.style.left);
        const newY=parseInt(slot.style.top);
        const newW=parseInt(slot.style.width);
        const newH=parseInt(slot.style.height);
        
        // 保存現有的簽名數據
        const currentSlot = eventMeta.slots[side][index];
        const signatureData = currentSlot.signatureData || null;
        
        eventMeta.slots[side][index]={x:newX, y:newY, w:newW, h:newH, signatureData};
        
        const {r,j}=await api(`/api/event/${encodeURIComponent(eventId)}/slots`,{
          method:'POST',
          body: JSON.stringify({A:eventMeta.slots.A, B:eventMeta.slots.B})
        });
        
        if(r.ok){
          // 重新繪製時保留簽名
          drawSlots();
          if(signatureData) {
            redrawSignature(side, index, signatureData);
          }
          renderQRCodes();
          showNotification(`✅ ${side==='A'?'甲方':'乙方'}簽名區域大小已更新`, 'success');
        } else {
          showNotification('❌ 大小更新失敗', 'error');
        }
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
    } else if(target){
      // 拖拽移動
      e.preventDefault();
      isDragging=true;
      dragElement=target;
      target.classList.add('dragging');
      
      const rect=stage.getBoundingClientRect();
      const startX=e.clientX-rect.left;
      const startY=e.clientY-rect.top;
      const startLeft=parseInt(target.style.left);
      const startTop=parseInt(target.style.top);
      
      const onMouseMove=(e)=>{
        if(!isDragging) return;
        const newX=startLeft+(e.clientX-rect.left-startX);
        const newY=startTop+(e.clientY-rect.top-startY);
        
        target.style.left=Math.max(0, Math.min(stage.width-parseInt(target.style.width), newX))+'px';
        target.style.top=Math.max(0, Math.min(stage.height-parseInt(target.style.height), newY))+'px';
      };
      
      const onMouseUp=async ()=>{
        if(!isDragging) return;
        isDragging=false;
        target.classList.remove('dragging');
        
        // 更新位置到後端
        const side=target.dataset.side;
        const index=parseInt(target.dataset.index);
        const newX=parseInt(target.style.left);
        const newY=parseInt(target.style.top);
        const newW=parseInt(target.style.width);
        const newH=parseInt(target.style.height);
        
        // 保存現有的簽名數據
        const currentSlot = eventMeta.slots[side][index];
        const signatureData = currentSlot.signatureData || null;
        
        eventMeta.slots[side][index]={x:newX, y:newY, w:newW, h:newH, signatureData};
        
        const {r,j}=await api(`/api/event/${encodeURIComponent(eventId)}/slots`,{
          method:'POST',
          body: JSON.stringify({A:eventMeta.slots.A, B:eventMeta.slots.B})
        });
        
        if(r.ok){
          // 重新繪製時保留簽名
          drawSlots();
          if(signatureData) {
            redrawSignature(side, index, signatureData);
          }
          renderQRCodes();
          showNotification(`✅ ${side==='A'?'甲方':'乙方'}簽名區域位置已更新`, 'success');
        } else {
          showNotification('❌ 位置更新失敗', 'error');
        }
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  });
}

// 事件處理器
document.addEventListener('DOMContentLoaded', function(){
  // 認證事件
  authLogin.onclick = async ()=>{
    const email=authEmail.value.trim(), password=authPwd.value.trim();
    const {r,j}=await api('/api/login',{method:'POST', body:JSON.stringify({email,password})});
    if(!r.ok){ authMsg.textContent=j.error||'登入失敗'; return; }
    setToken(j.token); showAuthMask(false); await loadEvents();
  };
  
  btnRegister.onclick=()=>{ regBox.hidden=false; forgotBox.hidden=true; resetBox.hidden=true; };
  btnForgot.onclick =()=>{ forgotBox.hidden=false; regBox.hidden=true; resetBox.hidden=true; };
  btnReset.onclick  =()=>{ resetBox.hidden=false; forgotBox.hidden=true; regBox.hidden=true; };
  
  doRegister.onclick=async ()=>{
    const email=regEmail.value.trim(), password=regPwd.value.trim();
    if(!/^[0-9]{6}$/.test(password)){ regMsg.textContent='密碼需為 6 位數字'; return; }
    const {r,j}=await api('/api/register',{method:'POST', body:JSON.stringify({email,password})});
    if(!r.ok){ regMsg.textContent=j.error||'註冊失敗'; return; }
    const login=await api('/api/login',{method:'POST', body:JSON.stringify({email,password})});
    if(login.r.ok){ setToken(login.j.token); showAuthMask(false); await loadEvents(); } else { regMsg.textContent='註冊成功，請回上方登入'; }
  };
  
  sendCode.onclick=async ()=>{ 
    const email=forgotEmail.value.trim(); 
    const {r,j}=await api('/api/forgot',{method:'POST', body:JSON.stringify({email})}); 
    forgotMsg.textContent=r.ok?(j.code?`驗證碼（測試）：${j.code}`:'已寄出'): (j.error||'失敗'); 
  };
  
  doReset.onclick =async ()=>{
    const email=resetEmail.value.trim(), code=resetCode.value.trim(), newPassword=resetPwd.value.trim();
    if(!/^[0-9]{6}$/.test(newPassword)){ resetMsg.textContent='新密碼需為 6 位數字'; return; }
    const {r,j}=await api('/api/reset',{method:'POST', body:JSON.stringify({email,code,newPassword})});
    resetMsg.textContent = r.ok ? '重設成功，請回上方登入。' : (j.error||'重設失敗');
  };
  
  logout.onclick=()=>{ clearToken(); events.innerHTML=''; showAuthMask(true); };

  // 智能自動排版
  applyCounts.onclick=async ()=>{
    if(!eventId) return alert('請先選擇房間或建立房間');

    const cntA=Math.max(0, parseInt(countA.value||'0',10));
    const cntB=Math.max(0, parseInt(countB.value||'0',10));
    
    if(cntA===0 && cntB===0) return alert('至少需要一個簽名區域');

    const layout=smartLayout(cntA, cntB, stage.width, stage.height);

    const {r,j}=await api(`/api/event/${encodeURIComponent(eventId)}/slots`,{
      method:'POST',
      body: JSON.stringify(layout)
    });
    if(!r.ok){ alert(j.error||'更新失敗'); return; }

    eventMeta.slots.A=layout.A; 
    eventMeta.slots.B=layout.B;
    drawSlots(); 
    renderQRCodes();
    
    showNotification('✅ 簽名區域已自動排版完成！', 'success');
  };


  // 重置位置
  resetPositions.onclick=async ()=>{
    if(!eventId) return alert('請先選擇房間');
    if(!confirm('確定要重置所有簽名區域位置嗎？')) return;
    
    const cntA=eventMeta.slots.A.length;
    const cntB=eventMeta.slots.B.length;
    const layout=smartLayout(cntA, cntB, stage.width, stage.height);

    const {r,j}=await api(`/api/event/${encodeURIComponent(eventId)}/slots`,{
      method:'POST',
      body: JSON.stringify(layout)
    });
    if(!r.ok){ alert(j.error||'重置失敗'); return; }

    eventMeta.slots.A=layout.A; 
    eventMeta.slots.B=layout.B;
    drawSlots(); 
    renderQRCodes();
    showNotification('🔄 簽名區域位置已重置', 'success');
  };

  // 背景圖片上傳
  backgroundUpload.onchange=(e)=>{
    const file=e.target.files[0];
    if(file && file.type.startsWith('image/')){
      loadBackgroundImage(file);
    } else {
      showNotification('❌ 請選擇有效的圖片檔案', 'error');
    }
  };

  // 清除背景
  clearBackground.onclick=()=>{
    if(confirm('確定要清除背景圖片嗎？')){
      clearBackgroundImage();
    }
  };

  // 縮放功能
  zoomIn.onclick=()=>{
    currentZoom=Math.min(2, currentZoom+0.2);
    stage.style.transform=`scale(${currentZoom})`;
    stage.style.transformOrigin='top left';
    showNotification(`🔍 縮放至 ${Math.round(currentZoom*100)}%`, 'info');
  };

  zoomOut.onclick=()=>{
    currentZoom=Math.max(0.5, currentZoom-0.2);
    stage.style.transform=`scale(${currentZoom})`;
    stage.style.transformOrigin='top left';
    showNotification(`🔍 縮放至 ${Math.round(currentZoom*100)}%`, 'info');
  };

  resetZoom.onclick=()=>{
    currentZoom=1;
    stage.style.transform='scale(1)';
    showNotification('🎯 縮放已重置', 'info');
  };

  // QR 下載功能
  downloadQR.onclick=()=>{
    const qrCanvases=document.querySelectorAll('.qrCard canvas');
    if(qrCanvases.length===0) return showNotification('❌ 沒有 QR 碼可下載', 'error');
    
    qrCanvases.forEach((canvas, i)=>{
      const link=document.createElement('a');
      link.download=`簽名QR_${eventId}_${i+1}.png`;
      link.href=canvas.toDataURL();
      link.click();
    });
    showNotification('💾 QR 碼已下載', 'success');
  };

  // QR 列印功能
  printQR.onclick=()=>{
    const qrSection=document.querySelector('.qrGrid').parentElement;
    const printWindow=window.open('', '_blank');
    printWindow.document.write(`
      <html><head><title>簽名 QR 碼</title>
      <style>body{font-family:Arial;text-align:center;padding:20px;}
      .qrCard{margin:20px;display:inline-block;border:1px solid #ccc;padding:10px;}
      canvas{display:block;margin:10px auto;}</style></head>
      <body><h1>簽名 QR 碼 - 房間 ${eventId}</h1>
      ${qrSection.innerHTML}</body></html>
    `);
    printWindow.document.close();
    printWindow.print();
    showNotification('🖨️ 列印視窗已開啟', 'info');
  };

  // 啟動
  showAuthMask(true);
  requireLogin().then(ok=>{
    const pre = new URL(location.href).searchParams.get('eventId');
    if(ok){ 
      loadEvents().then(()=>{ 
        if(pre) selectEvent(pre); 
        initDragAndDrop();
      }); 
    }
  });
});

// 其他函數（需要從原HTML中複製）
async function loadEvents(){
  if(!(await requireLogin())) return;
  const {r,j}=await api('/api/events'+(showAll?'?all=1':'')); 
  events.innerHTML='';
  if(!r.ok){ events.innerHTML='<div class="muted">讀取失敗，請重新登入</div>'; return; }
  (j.items||[]).forEach(ev=>{
    const card=document.createElement('div'); card.className='card';
    card.innerHTML=`
      <div style="font-weight:600;">房號：${ev.id}</div>
      <div class="muted">${ev.title}・${ev.stage.width}×${ev.stage.height}</div>
      <div class="muted"><span class="pill">建立於</span> ${ev.createdAt||''}</div>
      <div class="row" style="margin-top:6px;">
        <button class="open" data-id="${ev.id}">開啟</button>
        <a href="/admin.html?eventId=${ev.id}" target="_blank"><button type="button">新分頁</button></a>
        <button class="del" data-id="${ev.id}" style="margin-left:auto;border-color:#f1c0c0;background:#fff0f0">刪除此房</button>
      </div>`;
    events.appendChild(card);
  });
  events.querySelectorAll('button.open').forEach(b=> b.onclick=()=> selectEvent(b.dataset.id));
  events.querySelectorAll('button.del').forEach(b=> b.onclick=()=> deleteEvent(b.dataset.id));
}

async function selectEvent(id){
  eventId=id; eventMeta=await fetchEvent(id);
  stage.width=eventMeta.stage.width; stage.height=eventMeta.stage.height;
  eventInfo.textContent=`房號 ${eventMeta.id} ・ 畫布 ${stage.width}×${stage.height}`;
  drawSlots(); renderQRCodes();

  if(socket) socket.disconnect();
  socket = io(); socket.emit('join:event', {eventId, role:'admin'});
  socket.on('stroke', ({points,size,color, senderSide, senderIndex, sourceWidth, sourceHeight})=>{
    const arr=eventMeta.slots[senderSide]; if(!arr||!arr[senderIndex]) return;
    const s=arr[senderIndex], sx=s.w/sourceWidth, sy=s.h/sourceHeight;
    
    // 保存簽名數據
    if(!s.signatureData) {
      s.signatureData = {
        originalWidth: sourceWidth,
        originalHeight: sourceHeight,
        strokes: []
      };
    }
    
    // 添加新的筆劃
    s.signatureData.strokes.push({
      points: points,
      size: size,
      color: color
    });
    
    ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=size*Math.max(sx,sy);
    ctx.beginPath(); const p0=points[0]; ctx.moveTo(s.x+p0[0]*sx, s.y+p0[1]*sy);
    for(let i=1;i<points.length;i++){ const p=points[i]; ctx.lineTo(s.x+p[0]*sx, s.y+p[1]*sy); }
    ctx.stroke(); ctx.restore();
  });
  socket.on('clear', ({senderSide, senderIndex})=>{
    const arr=eventMeta.slots[senderSide];
    if(!arr || !arr[senderIndex]) return;
    const s=arr[senderIndex];
    
    // 清除簽名數據
    s.signatureData = null;
    
    ctx.clearRect(s.x, s.y, s.w, s.h);
    ctx.save();
    ctx.strokeStyle='#777';
    ctx.lineWidth=2;
    ctx.font='16px system-ui';
    ctx.fillStyle='#444';
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.fillText(`${senderSide}-${Number(senderIndex)+1}`, s.x+8, s.y+20);
    ctx.restore();
  });
  socket.on('slots:update', ({A,B})=>{ eventMeta.slots.A=A; eventMeta.slots.B=B; drawSlots(); renderQRCodes(); });
  socket.on('event:deleted', (p)=>{ if(p?.eventId===eventId){ alert('此房間已被刪除'); eventId=null; eventMeta=null; resetCanvasUI(); }});
}

async function deleteEvent(id){
  if(!confirm(`確定刪除房號 ${id}？`)) return;
  const {r,j}=await api('/api/event/'+encodeURIComponent(id),{method:'DELETE'});
  if(!r.ok){ alert(j.error||'刪除失敗'); return; }
  if(eventId===id){ eventId=null; eventMeta=null; resetCanvasUI(); }
  await loadEvents();
}

createEvent.onclick=async ()=>{
  if(!(await requireLogin())) return;
  const stageWidth=parseInt(w.value||'1000',10), stageHeight=parseInt(h.value||'1000',10);
  const title=document.getElementById('title').value.trim()||undefined;
  const {r,j}=await api('/api/create-event',{method:'POST', body:JSON.stringify({title,stageWidth,stageHeight})});
  if(!r.ok){ alert(j.error||'建立失敗'); return; }
  await loadEvents(); await selectEvent(j.eventId);
};

refreshEvents.onclick=loadEvents;

clearMine.onclick=async ()=>{
  if(!confirm('確定刪除你的所有歷史？')) return;
  const {r,j}=await api('/api/events/clear',{method:'POST'});
  if(!r.ok){ alert(j.error||'清除失敗'); return; }
  eventId=null; eventMeta=null; resetCanvasUI(); await loadEvents();
};

toggleAll.onclick = async ()=>{ showAll=!showAll; toggleAll.textContent=showAll?'只顯示我的':'顯示全部房間'; await loadEvents(); };

clearAllUsers.onclick = async ()=>{
  if(!confirm('【管理者】確定刪除所有人的歷史？')) return;
  const {r,j}=await api('/api/admin/events/clear-all',{method:'POST'});
  if(!r.ok){ alert(j.error||'清除失敗'); return; }
  eventId=null; eventMeta=null; resetCanvasUI(); await loadEvents();
};
