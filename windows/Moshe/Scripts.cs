using System.Text.Json;

namespace Moshe;

/// <summary>What the window puts in the page before the page's own scripts run (WebView2's document-created scripts).</summary>
static class Scripts
{
    /// <summary>
    /// window.mosheShell, the folder bridge's transport when <paramref name="storage"/>,
    /// and the shell's own keys — in the app's own pages only (<paramref name="origins"/>),
    /// and only in the top frame.
    /// </summary>
    public static string Shell(IEnumerable<string> origins, bool storage) => $$"""
        (() => {
          const ours = {{JsonSerializer.Serialize(origins)}};
          const wv = window.chrome && window.chrome.webview;
          if (window.top !== window || !wv || !ours.includes(location.origin)) return;
          const post = (m) => wv.postMessage(m);

          // window.mosheShell (docs/BRIDGE.md, 5): each call a message, its promise settled by the reply
          let next = 1;
          const waiting = new Map();
          const call = (op, args) => new Promise((resolve, reject) => {
            const id = next++;
            waiting.set(id, { resolve, reject });
            post({ channel: 'shell', id, op, args });
          });
          window.mosheShell = Object.freeze({
            savePdf: (html, fileName) => call('savePdf', { html: String(html), fileName: String(fileName || 'Export.pdf') }),
            saveFile: (fileName, base64, mime) => call('saveFile', { fileName: String(fileName), base64: String(base64), mime: String(mime || '') }),
            share: (fileName, base64, mime) => call('share', { fileName: String(fileName), base64: String(base64), mime: String(mime || '') }),
            sharePdf: (html, fileName) => call('sharePdf', { html: String(html), fileName: String(fileName || 'Export.pdf') }),
            openExternal: (url) => call('openExternal', { url: String(url) }),
            copy: (what) => call('copy', { text: String((what && what.text) || ''), html: what && what.html ? String(what.html) : '' }),
          });

          // the folder bridge (docs/BRIDGE.md, 2) with Android's transport, which the
          // page already speaks: request(id, json), answered by __mosheStorageReply
          if ({{(storage ? "true" : "false")}} && location.origin === {{JsonSerializer.Serialize(AppScheme.Origin)}}) {
            window.MosheStorage = Object.freeze({ request: (id, json) => post({ channel: 'storage', id, json: String(json) }) });
          }

          wv.addEventListener('message', (e) => {
            const m = e.data;
            if (!m || typeof m !== 'object') return;
            if (m.channel === 'storage') {
              if (window.__mosheStorageReply) window.__mosheStorageReply(m.id, m.reply);
              return;
            }
            if (m.channel === 'shell') {
              const w = waiting.get(m.id);
              if (!w) return;
              waiting.delete(m.id);
              if (m.error !== undefined) w.reject(new Error(m.error)); else w.resolve(m.ok);
            }
          });

          // The shell's own keys, if the page leaves them alone: Ctrl+W closes the
          // window, Ctrl+Alt+N opens another, F11 is full screen. AltGr is Ctrl+Alt
          // on many keyboards and types letters, so it never counts.
          const shellKey = (e) => {
            if (e.getModifierState && e.getModifierState('AltGraph')) return null;
            if (e.key === 'F11' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return 'fullScreen';
            if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyW') return 'close';
            if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyN') return 'newWindow';
            return null;
          };
          window.addEventListener('keydown', (e) => {
            const what = shellKey(e);
            if (what) setTimeout(() => { if (!e.defaultPrevented) post({ channel: 'window', what }); }, 0);
          }, true);

          // The menus' keys, as in any Windows app: Alt and a menu's letter opens it
          // (File, Edit, fOrmat, View, Help), and Alt alone, pressed and let go,
          // puts the keyboard on the menu bar. Again only if the page leaves them alone.
          const letters = ['F', 'E', 'O', 'V', 'H'];
          let altAlone = false;
          window.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') { altAlone = !e.ctrlKey && !e.shiftKey && !e.metaKey; return; }
            altAlone = false;
            if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || (e.getModifierState && e.getModifierState('AltGraph'))) return;
            const m = /^Key([A-Z])$/.exec(e.code || '');
            if (m && letters.includes(m[1])) setTimeout(() => { if (!e.defaultPrevented) post({ channel: 'window', what: 'menu', letter: m[1] }); }, 0);
          }, true);
          window.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' && altAlone) { altAlone = false; post({ channel: 'window', what: 'menu' }); }
          }, true);
          window.addEventListener('blur', () => { altAlone = false; });
        })();
        """;
}
