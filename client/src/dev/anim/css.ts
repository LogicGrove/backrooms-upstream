export const CSS = `
.st{position:fixed;inset:0;display:grid;grid-template-rows:40px 1fr;background:#101214;color:#d7dcdf;font:12px/1.45 ui-monospace,Consolas,monospace}
.st *{box-sizing:border-box}
.st-top{grid-column:1/-1;display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid #2a2e33;background:#14171a}
.st-logo{letter-spacing:.14em;color:#8fc9aa;margin-right:10px}
.st-grow{flex:1}
.st-msg{color:#8fc9aa}
.st button,.st select,.st input{font:inherit;color:#d7dcdf}
.st button{background:#1c2024;border:1px solid #3a4046;padding:3px 9px;cursor:pointer;border-radius:3px}
.st button:hover{background:#262b30}
.st select,.st input[type=number],.st input[type=text],.st input:not([type]){background:#181b1e;border:1px solid #3a4046;padding:2px 4px;border-radius:3px;min-width:0}
.st-tab{border:none!important;background:none!important;border-bottom:2px solid transparent!important;border-radius:0!important;padding:10px 12px!important;letter-spacing:.08em;color:#8b949a}
.st-tab[data-on]{color:#fff;border-bottom-color:#4a8f72!important}
.st-tab.sm{padding:4px 9px!important;font-size:11px;border-bottom-width:2px!important}
.st-save[data-dirty]{background:#7a4b1a;border-color:#c0793c}
.st-lib{grid-row:2;grid-column:1;overflow:auto;padding:8px;border-right:1px solid #2a2e33;background:#13161a}
.st-search{width:100%;margin-bottom:6px}
.st-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.st-chips button{padding:1px 7px;font-size:11px;border-color:var(--c,#3a4046)}
.st-chips button[data-on]{background:var(--c,#2f5d4a);color:#fff}
.st-chips.big button{padding:5px 10px;font-size:12px}
.st-cards{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.st-card{position:relative;background:#1a1e22;border:1px solid #2a2e33;border-radius:4px;overflow:hidden;cursor:grab}
.st-card:hover{border-color:#6aa88c}
.st-card[data-on]{border-color:#8fc9aa;box-shadow:0 0 0 1px #8fc9aa}
.st-card img{display:block;width:100%;aspect-ratio:112/148;object-fit:cover;background:#1c2024}
.st-card b{display:block;padding:2px 5px 0;font-weight:500;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-card small{display:block;padding:0 5px 3px;color:#7d868c;font-size:10px}
.st-dot{position:absolute;top:5px;left:5px;width:9px;height:9px;border-radius:50%;border:1px solid #0008}
.st-center{grid-row:2;grid-column:3;display:flex;flex-direction:column;min-width:0;min-height:0}
.st-view{position:relative;flex:1;min-height:200px}
.st-view canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.st-ov{position:absolute;left:10px;top:8px;display:flex;gap:14px;align-items:center;color:#9aa3a9;pointer-events:none;text-shadow:0 1px 2px #000}
.st-ov b{color:#fff}.st-playing{color:#c0793c}
.st-keys{position:absolute;left:0;top:22px;white-space:nowrap}
.st-side{grid-row:2;grid-column:5;overflow:auto;padding:10px 14px;border-left:1px solid #2a2e33;background:#13161a}
.st-side h3{margin:4px 0 6px;font-size:14px;color:#fff;font-weight:600}
.st h4{margin:14px 0 5px;color:#8fc9aa;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.st-hint{color:#7d868c;margin:4px 0}
kbd{background:#23282d;border:1px solid #3a4046;border-bottom-width:2px;border-radius:3px;padding:0 5px;color:#d7dcdf;font:inherit;font-size:11px}
.st-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}
.st-w{width:60px;color:#9aa3a9}
.st-chk{display:flex;gap:4px;align-items:center;color:#9aa3a9}
.st-num{display:flex;gap:4px;align-items:center;color:#9aa3a9}.st-num input{width:58px}
.st-name{width:150px}
.st-big{padding:6px 12px!important}
.st-big[data-on]{background:#2f5d4a;border-color:#4a8f72}
.st-x{padding:0 5px!important;color:#c97b7b!important;background:none!important;border:none!important}
.st-slots{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:6px 0}
.st-slot{border:1px dashed #3a4046;border-radius:4px;padding:3px;text-align:center;background:#171a1e;min-width:0}
.st-slot:hover{border-color:#8fc9aa}
.st-slot img{width:100%;aspect-ratio:112/100;object-fit:cover;object-position:top;border-radius:2px;background:#1c2024}
.st-slot b{display:block;font-size:11px;color:#8fc9aa}.st-slot small{display:block;color:#7d868c;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-vcard{border:1px solid #2a2e33;border-radius:5px;padding:8px;margin:8px 0;background:#171a1e}
.st-vcard[data-on]{border-color:#4a8f72}
.st-dock{height:var(--dockh,300px);flex:none;overflow:auto;border-top:1px solid #2a2e33;background:#13161a;padding:8px 12px}
.st-time{font-variant-numeric:tabular-nums;color:#9aa3a9}
.st-play{width:36px;background:#2f5d4a!important;border-color:#4a8f72!important}
.st-track{position:relative;overflow-x:auto;overflow-y:hidden;height:150px;background:#0e1113;border:1px solid #2a2e33;border-radius:4px}
.st-inner{position:relative;height:100%}
.st-ruler{position:absolute;inset:0 0 auto 0;height:20px;border-bottom:1px solid #23282d;cursor:pointer}
.st-ruler span{position:absolute;top:2px;padding-left:3px;border-left:1px solid #2f353a;color:#6d767c;font-size:10px;height:16px}
.st-empty{position:absolute;top:60px;left:20px;color:#6d767c}
.st-seg{position:absolute;display:flex;align-items:center;gap:5px;padding:0 10px 0 6px;overflow:hidden;background:color-mix(in srgb,var(--c) 28%,#1a1e22);border:1px solid var(--c);border-radius:4px;cursor:grab;user-select:none;white-space:nowrap}
.st-seg[data-on]{box-shadow:0 0 0 2px #fff6;background:color-mix(in srgb,var(--c) 45%,#1a1e22)}
.st-seg img{height:100%;aspect-ratio:1;object-fit:cover;object-position:top;border-radius:2px;pointer-events:none}
.st-seg b{font-weight:500;pointer-events:none;overflow:hidden;text-overflow:ellipsis}
.st-seg em{font-style:normal;color:#fff;background:#0007;padding:0 4px;border-radius:3px;pointer-events:none}
.st-fade{position:absolute;left:0;top:0;bottom:0;background:repeating-linear-gradient(135deg,#ffffff30 0 4px,transparent 4px 8px);pointer-events:none}
.st-h{position:absolute;top:0;bottom:0;width:9px;cursor:ew-resize;background:#fff2}.st-h:hover{background:#fff6}
.st-h.l{left:0}.st-h.r{right:0}
.st-head{position:absolute;top:0;bottom:0;width:2px;background:#ff7a59;pointer-events:none}
.st-segbar{padding:6px;background:#171a1e;border-radius:4px;margin-top:6px}
.st-states{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.st-state{padding:6px 16px!important;border-radius:14px!important;position:relative}
.st-state[data-on]{background:#2f5d4a!important;border-color:#4a8f72!important}
.st-state i{color:#7be0a5;font-style:normal;margin-left:6px}
.st-strip{margin:4px 0 6px}
.st-axis{position:relative;height:150px;margin:0 60px 0 40px;border-bottom:2px solid #3a4046;cursor:crosshair}
.st-tick{position:absolute;bottom:-18px;transform:translateX(-50%);color:#6d767c;font-size:10px}
.st-needle{position:absolute;top:0;bottom:0;width:2px;background:#ff7a59;pointer-events:none}
.st-mark{position:absolute;bottom:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;cursor:default}
.st-mark small{color:#9aa3a9}
.st-pin{width:12px;height:12px;background:#8fc9aa;border-radius:50%;cursor:ew-resize;order:3;margin-bottom:-6px;z-index:2}
.st-mcard{width:70px;border:1px dashed #3a4046;border-radius:4px;padding:3px;background:#171a1e;text-align:center}
.st-mcard:hover{border-color:#8fc9aa}
.st-mcard img{width:100%;aspect-ratio:112/90;object-fit:cover;object-position:top;border-radius:2px}
.st-mcard b{display:block;font-size:11px;color:#8fc9aa}.st-mcard small{display:block;font-size:9px;color:#7d868c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-states .st-hint{margin-left:6px}
.st-trans{padding:2px 0}.st-cond{display:inline-flex;gap:3px;align-items:center;background:#1a1e22;border-radius:3px;padding:1px 3px}.st-cond input{width:50px}
.st-cond em{font-style:normal;color:#9aa3a9}
.st-sp{background:#1b1f23;z-index:3}.st-sp:hover,.st-sp:active{background:#4a8f72}
.st-sp.v{grid-row:2;cursor:col-resize}.st-sp.h{height:5px;cursor:row-resize;flex:none}
.st-cambar{position:absolute;top:8px;right:8px;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:70%;z-index:2}
.st-cambar button{background:#14171acc;padding:2px 7px}.st-cambar button[data-on]{background:#2f5d4a;border-color:#4a8f72}
.st-cambar kbd{margin-left:5px;opacity:.6;font-size:10px}.st-cambar i{width:8px}
.st-mando{position:absolute;left:8px;bottom:8px;background:#101316e6;border:1px solid #2a2e33;border-radius:5px;z-index:2;max-width:calc(100% - 16px)}
.st-mando-h{width:100%;text-align:left;border:none!important;background:none!important;letter-spacing:.1em;color:#8fc9aa}
.st-mando-b{display:flex;gap:10px;padding:2px 10px 10px;align-items:flex-start}
.st-stick{position:relative;width:96px;height:96px;flex:none;border-radius:50%;background:radial-gradient(#23282d,#15181b);border:1px solid #3a4046;touch-action:none;cursor:grab}
.st-stick i{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#4a8f72;box-shadow:0 0 0 2px #0006;pointer-events:none}
.st-mando-c{display:flex;flex-direction:column;gap:5px;min-width:200px}
.st-mando-c label{display:flex;gap:6px;align-items:center;color:#9aa3a9}.st-mando-c input[type=range]{flex:1;min-width:70px}
.st-seg3{display:flex;gap:3px;flex-wrap:wrap}.st-seg3 button{padding:1px 7px;font-size:11px}.st-seg3 button[data-on]{background:#2f5d4a;border-color:#4a8f72}
.st-help{position:absolute;inset:0;background:#000a;z-index:20;display:grid;place-items:center}
.st-help>div{background:#171a1e;border:1px solid #3a4046;border-radius:6px;padding:16px 22px;max-width:520px}
.st-help td{padding:2px 10px 2px 0;vertical-align:top}
`;