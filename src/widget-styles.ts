/** Styles for the widget. Injected into a shadow root, so nothing leaks either way. */
export const WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: var(--wc-font); }
[hidden] { display: none !important; }

:host {
  --wc-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --wc-accent: #3b6cff;
  --wc-on-accent: #ffffff;
  --wc-bg: #ffffff;
  --wc-fg: #14161a;
  --wc-muted: #6b7280;
  --wc-line: rgba(20, 22, 26, .09);
  --wc-header-bg: #ffffff;
  --wc-header-fg: #14161a;
  --wc-user-bg: #3b6cff;
  --wc-user-fg: #ffffff;
  --wc-assistant-bg: #f1f4f9;
  --wc-assistant-fg: #14161a;
  --wc-radius: 18px;
  --wc-bubble-radius: 18px;
  --wc-shadow: 0 18px 50px rgba(15, 20, 40, .22);
}

.root { position: fixed; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
.root[data-position="bottom-right"] { right: 20px; bottom: 20px; }
.root[data-position="bottom-left"] { left: 20px; bottom: 20px; align-items: flex-start; }
.root[data-inline="true"] { position: static; width: 100%; height: 100%; }

.launcher {
  width: 58px; height: 58px; border-radius: 50%; border: 0; cursor: pointer;
  background: var(--wc-accent); color: var(--wc-on-accent);
  box-shadow: 0 12px 28px rgba(15, 20, 40, .28); display: grid; place-items: center;
  transition: transform .15s ease;
}
.launcher:hover { transform: scale(1.05); }
.launcher svg { width: 26px; height: 26px; }
.launcher img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }

.teaser {
  position: relative; max-width: 260px; padding: 12px 34px 12px 14px; border-radius: 16px;
  background: var(--wc-bg); color: var(--wc-fg); font-size: 14px; line-height: 1.45;
  box-shadow: var(--wc-shadow); cursor: pointer; animation: wc-rise .25s ease;
}
.teaser .teaser-close { position: absolute; top: 6px; right: 6px; border: 0; background: transparent; color: var(--wc-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.teaser .teaser-close:hover { background: var(--wc-line); }
@keyframes wc-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.panel {
  width: min(400px, calc(100vw - 32px)); height: min(600px, calc(100vh - 120px));
  background: var(--wc-bg); color: var(--wc-fg);
  border-radius: var(--wc-radius);
  box-shadow: var(--wc-shadow); overflow: hidden;
  display: flex; flex-direction: column; position: relative;
}
.root[data-inline="true"] .panel { width: 100%; height: 100%; box-shadow: none; border-radius: 0; }

.header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--wc-header-bg); color: var(--wc-header-fg); border-bottom: 1px solid var(--wc-line); }
.avatar { width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--wc-accent); color: var(--wc-on-accent); font-size: 14px; font-weight: 600; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.title { font-size: 14px; font-weight: 600; margin: 0; }
.subtitle { font-size: 12px; opacity: .7; margin: 1px 0 0; display: flex; align-items: center; gap: 6px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wc-muted); flex: none; }
.dot[data-status="connected"] { background: #2f9e44; }
.dot[data-status="connecting"], .dot[data-status="reconnecting"] { background: #f08c00; }
.dot[data-status="disconnected"] { background: #e03131; }
.header .spacer { margin-left: auto; }
.icon-button { border: 0; background: transparent; color: inherit; opacity: .7; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 6px; border-radius: 8px; }
.icon-button:hover { opacity: 1; background: rgba(127, 127, 127, .15); }
.icon-button svg { width: 18px; height: 18px; display: block; }
.newchat { border: 1px solid currentColor; background: transparent; color: inherit; opacity: .8; cursor: pointer; font-size: 12px; padding: 5px 10px; border-radius: 999px; }
.newchat:hover { opacity: 1; }

.disclaimer { font-size: 11.5px; color: var(--wc-muted); padding: 8px 14px; text-align: center; border-bottom: 1px solid var(--wc-line); background: var(--wc-bg); }

.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }

/* A block of consecutive messages: avatar and time on top, bubbles underneath. */
.group { display: flex; flex-direction: column; gap: 6px; max-width: 82%; }
.root[data-bubbles="wide"] .group { max-width: 94%; }
.group[data-role="user"] { align-self: flex-end; align-items: flex-end; }
.group-head { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--wc-muted); }
.group-head .avatar { width: 26px; height: 26px; font-size: 11px; }
.group[data-role="user"] .group-head { display: none; }
.root[data-avatars="false"] .group-head .avatar { display: none; }
.root[data-timestamps="hidden"] .time { display: none; }
.root[data-avatars="false"][data-timestamps="hidden"] .group-head { display: none; }
.group-body { display: flex; flex-direction: column; gap: 6px; }
.group[data-role="user"] .group-body { align-items: flex-end; }

.msg { display: flex; flex-direction: column; gap: 4px; }
.bubble {
  padding: 10px 14px; border-radius: var(--wc-bubble-radius); font-size: 14px; line-height: 1.5;
  white-space: pre-wrap; word-wrap: break-word; background: var(--wc-assistant-bg); color: var(--wc-assistant-fg);
}
/* Only the last bubble of a block gets the tail. */
.msg[data-role="assistant"]:last-child .bubble { border-bottom-left-radius: 6px; }
.msg[data-role="user"] .bubble { background: var(--wc-user-bg); color: var(--wc-user-fg); }
.msg[data-role="user"]:last-child .bubble { border-bottom-right-radius: 6px; }
.root[data-bubbles="wide"] .bubble { border-radius: 10px; padding: 12px 16px; }
.msg[data-status="error"] .bubble { background: #ffe3e3; color: #b02525; }
.meta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--wc-muted); padding: 0 4px; min-height: 16px; }
.msg[data-role="user"] .meta { justify-content: flex-end; }

.tools { display: flex; flex-wrap: wrap; gap: 6px; }
.tool { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--wc-line); color: var(--wc-muted); }
.tool[data-status="completed"] { border-color: #2f9e44; color: #2f9e44; }
.tool[data-status="failed"] { border-color: #e03131; color: #e03131; }

.feedback { display: inline-flex; gap: 2px; }
.feedback button { border: 0; background: transparent; color: var(--wc-muted); cursor: pointer; padding: 2px 4px; border-radius: 6px; display: grid; place-items: center; }
.feedback button svg { width: 14px; height: 14px; }
.feedback button:hover { background: var(--wc-line); color: var(--wc-fg); }
.feedback button[aria-pressed="true"] { color: var(--wc-accent); }

.typing { display: inline-flex; gap: 4px; padding: 4px 0; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--wc-muted); animation: wc-bounce 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes wc-bounce { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .typing span { animation: none; } .launcher { transition: none; } .teaser { animation: none; } }

.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--wc-line); background: var(--wc-bg); }
.composer input {
  flex: 1; min-width: 0; padding: 10px 14px; font-size: 14px;
  border: 1px solid var(--wc-line); border-radius: 12px;
  background: transparent; color: var(--wc-fg);
}
.composer input:focus { outline: 2px solid var(--wc-accent); outline-offset: -1px; }
.composer button {
  border: 0; border-radius: 12px; padding: 0 16px; cursor: pointer;
  background: var(--wc-accent); color: var(--wc-on-accent); font-size: 14px; font-weight: 500;
}
.composer button:disabled { opacity: .5; cursor: default; }
.composer button.icon-send { width: 42px; padding: 0; border-radius: 50%; display: grid; place-items: center; }
.composer button.icon-send svg { width: 18px; height: 18px; }

.gate { position: absolute; inset: 0; background: var(--wc-bg); display: flex; flex-direction: column; justify-content: flex-end; padding: 20px; gap: 12px; z-index: 2; }
.gate .gate-card { background: var(--wc-assistant-bg); color: var(--wc-assistant-fg); border-radius: 16px; padding: 16px; font-size: 13.5px; line-height: 1.55; max-height: 60%; overflow: auto; }
.gate h3 { margin: 0 0 8px; font-size: 15px; }
.gate p { margin: 0; white-space: pre-wrap; }
.gate button { border: 0; border-radius: 12px; padding: 12px; cursor: pointer; background: var(--wc-accent); color: var(--wc-on-accent); font-size: 14px; font-weight: 600; }

.error { margin: 0; padding: 0 14px 10px; font-size: 12px; color: #e03131; }
`;
