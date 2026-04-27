export function renderEditorHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>super-ppt 独立编辑器</title>
    <script src="/docmee/docmee-ui-sdk-iframe.min.js"></script>
    <style>
      :root {
        color-scheme: light;
        font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      }

      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #f5f7fa;
        color: #1f1f1f;
      }

      * {
        box-sizing: border-box;
      }

      #container {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
      }

      .status {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 30;
        max-width: min(720px, calc(100vw - 32px));
        padding: 12px 16px;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
        font-size: 14px;
        line-height: 1.6;
      }

      .status.info {
        background: #e6f4ff;
        color: #0958d9;
        border: 1px solid #91caff;
      }

      .status.error {
        background: #fff2f0;
        color: #cf1322;
        border: 1px solid #ffccc7;
      }

      .hidden {
        display: none !important;
      }

      .overlay {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.38);
        backdrop-filter: blur(8px);
      }

      .card {
        width: min(540px, calc(100vw - 48px));
        padding: 28px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
      }

      .title {
        margin: 0 0 10px;
        font-size: 22px;
        line-height: 1.3;
      }

      .desc {
        margin: 0 0 18px;
        color: #595959;
        font-size: 14px;
        line-height: 1.75;
      }

      .meta {
        margin: 0 0 20px;
        padding: 14px 16px;
        border-radius: 12px;
        background: #f7f8fa;
        color: #434343;
        font-size: 13px;
        line-height: 1.8;
        white-space: pre-line;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      button {
        appearance: none;
        height: 40px;
        padding: 0 18px;
        border: 1px solid #d9d9d9;
        border-radius: 10px;
        background: #fff;
        color: #1f1f1f;
        font-size: 14px;
        cursor: pointer;
      }

      button.primary {
        border-color: #1677ff;
        background: #1677ff;
        color: #fff;
      }

      button:disabled {
        opacity: 0.56;
        cursor: not-allowed;
      }
    </style>
  </head>
  <body>
    <div class="status info" id="status">正在创建 Docmee 编辑会话...</div>
    <div class="overlay hidden" id="overlay">
      <div class="card">
        <h1 class="title" id="overlayTitle">当前 PPT 已在其他窗口中编辑</h1>
        <p class="desc" id="overlayDescription">为了避免 Docmee token 被多个窗口互相顶掉，当前同一个 PPT 仅允许一个活跃编辑会话。</p>
        <div class="meta" id="overlayMeta">正在读取会话占用信息...</div>
        <div class="actions">
          <button class="primary" id="primaryAction" type="button">接管编辑</button>
          <button id="secondaryAction" type="button">刷新页面</button>
        </div>
      </div>
    </div>
    <div id="container"></div>

    <script>
      (function () {
        var HEARTBEAT_INTERVAL_MS = 30000;
        var params = new URLSearchParams(window.location.search);
        var jobId = (params.get('jobId') || '').trim();
        var statusNode = document.getElementById('status');
        var overlayNode = document.getElementById('overlay');
        var overlayTitleNode = document.getElementById('overlayTitle');
        var overlayDescriptionNode = document.getElementById('overlayDescription');
        var overlayMetaNode = document.getElementById('overlayMeta');
        var primaryActionButton = document.getElementById('primaryAction');
        var secondaryActionButton = document.getElementById('secondaryAction');
        var containerNode = document.getElementById('container');

        var docmeeUI = null;
        var currentSession = null;
        var heartbeatTimer = 0;
        var currentOverlayMode = 'none';
        var requestedCurrentPptInfo = false;

        function getStorageKey() {
          return 'super-ppt-editor:' + jobId + ':clientId';
        }

        function createClientId() {
          if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
          }
          return 'sp-client-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        }

        function getOrCreateClientId() {
          var key = getStorageKey();
          var existing = window.sessionStorage.getItem(key);
          if (existing) {
            return existing;
          }
          var created = createClientId();
          window.sessionStorage.setItem(key, created);
          return created;
        }

        function getBrowserLabel() {
          var ua = window.navigator.userAgent || '';
          if (/Codex/i.test(ua)) {
            return 'Codex Browser';
          }
          if (/Chrome/i.test(ua)) {
            return 'Chrome';
          }
          if (/Safari/i.test(ua)) {
            return 'Safari';
          }
          if (/Firefox/i.test(ua)) {
            return 'Firefox';
          }
          return 'Browser';
        }

        var clientId = jobId ? getOrCreateClientId() : '';
        var clientLabel = clientId ? (getBrowserLabel() + ' · ' + clientId.slice(0, 8)) : '';

        function setStatus(message, kind) {
          statusNode.textContent = message;
          statusNode.className = 'status ' + (kind || 'info');
          statusNode.classList.remove('hidden');
        }

        function hideStatus() {
          statusNode.classList.add('hidden');
        }

        function stopHeartbeat() {
          if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = 0;
          }
        }

        function startHeartbeat() {
          stopHeartbeat();
          heartbeatTimer = window.setInterval(function () {
            void sendHeartbeat();
          }, HEARTBEAT_INTERVAL_MS);
        }

        function syncTitle(session) {
          var subject = session && session.subject ? session.subject : 'super-ppt 独立编辑器';
          document.title = subject;
        }

        function toSafePptFileName(subject) {
          var value = String(subject || 'super-ppt')
            .replace(/[\\\\/:*?"<>|]+/g, '_')
            .replace(/\\s+/g, ' ')
            .trim();
          return value || 'super-ppt';
        }

        function createBeforeMessageResponse(message, session) {
          if (!message || typeof message.type !== 'string') {
            return true;
          }

          if (message.type === 'beforeDownload') {
            var subject = message.data && message.data.subject ? message.data.subject : session.subject;
            return 'PPT_' + toSafePptFileName(subject) + '.pptx';
          }

          return true;
        }

        function formatTime(value) {
          if (!value) {
            return '-';
          }
          try {
            return new Date(value).toLocaleString('zh-CN', { hour12: false });
          } catch (error) {
            return value;
          }
        }

        function showOverlay(payload, mode) {
          currentOverlayMode = mode;
          overlayNode.classList.remove('hidden');

          var title = '当前 PPT 已在其他窗口中编辑';
          var description = '为了避免 Docmee token 被多个窗口互相顶掉，当前同一个 PPT 仅允许一个活跃编辑会话。';
          if (payload && payload.code === 'PRESENTATION_SESSION_TAKEN_OVER') {
            title = '当前编辑会话已被其他窗口接管';
            description = '当前窗口已经失去保存和导出权限。你可以刷新页面查看最新状态，或再次显式接管。';
          } else if (payload && payload.code === 'PRESENTATION_SESSION_EXPIRED') {
            title = '当前编辑会话已失效';
            description = '当前窗口的编辑租约已过期，你可以重新连接会话。';
          }

          overlayTitleNode.textContent = title;
          overlayDescriptionNode.textContent = description;

          var holderText = '当前窗口：' + (clientLabel || clientId || '-') + '\\n';
          if (payload && payload.holder) {
            holderText += '当前持有者：' + (payload.holder.clientLabel || payload.holder.clientId || '-') + '\\n';
            holderText += '最近活跃：' + formatTime(payload.holder.lastActiveAt) + '\\n';
            holderText += '租约截止：' + formatTime(payload.holder.leaseExpireAt);
          } else {
            holderText += '当前持有者：-' + '\\n';
            holderText += '租约截止：' + formatTime(payload && payload.leaseExpireAt);
          }
          overlayMetaNode.textContent = holderText;

          primaryActionButton.textContent = payload && payload.canTakeover ? '接管编辑' : '重新连接';
        }

        function hideOverlay() {
          currentOverlayMode = 'none';
          overlayNode.classList.add('hidden');
        }

        async function requestSession(action, payload) {
          var response = await fetch(
            '/api/external-skills/jobs/' + encodeURIComponent(jobId) + '/presentation-session/' + action,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
              },
              body: JSON.stringify(payload || {})
            }
          );
          var data = await response.json().catch(function () {
            return {
              code: 'INVALID_RESPONSE',
              message: '编辑会话服务返回了无法识别的响应'
            };
          });
          return {
            ok: response.ok,
            status: response.status,
            payload: data
          };
        }

        function stringifyMessageForLog(message) {
          try {
            return JSON.stringify(message);
          } catch (error) {
            return String(message);
          }
        }

        function buildEditor(session) {
          if (!window.DocmeeUI) {
            throw new Error('Docmee SDK 未成功加载');
          }

          hideStatus();
          hideOverlay();
          syncTitle(session);

          if (docmeeUI) {
            docmeeUI.updateToken(session.token);
            if (!requestedCurrentPptInfo && typeof docmeeUI.getCurrentPptInfo === 'function') {
              requestedCurrentPptInfo = true;
              window.setTimeout(function () {
                try {
                  docmeeUI.getCurrentPptInfo();
                } catch (error) {
                  console.warn('[super-ppt-editor] getCurrentPptInfo failed', error);
                }
              }, 800);
            }
            return;
          }

          docmeeUI = new window.DocmeeUI({
            pptId: session.pptId,
            token: session.token,
            animation: Boolean(session.animation),
            container: containerNode,
            page: 'editor',
            lang: 'zh',
            mode: 'light',
            isMobile: window.innerWidth < 768,
            background: '#f5f7fa',
            padding: '0px',
            onMessage: function (message) {
              console.log('[super-ppt-editor] Docmee message', stringifyMessageForLog(message));
              if (message && typeof message.type === 'string' && message.type.startsWith('before')) {
                return createBeforeMessageResponse(message, currentSession || session);
              }

              if (message && message.type === 'invalid-token') {
                setStatus('Docmee Token 已失效，正在重新获取编辑权限...', 'info');
                void openSession({ takeover: false, silentStatus: true }).then(function () {
                  if (currentSession) {
                    setStatus('Docmee Token 已刷新。', 'info');
                    window.setTimeout(hideStatus, 1200);
                  }
                }).catch(function (error) {
                  setStatus(error instanceof Error ? error.message : 'Docmee Token 刷新失败', 'error');
                });
              }

              return undefined;
            }
          });
          window.__superPptDocmeeUI = docmeeUI;
          if (!requestedCurrentPptInfo && typeof docmeeUI.getCurrentPptInfo === 'function') {
            requestedCurrentPptInfo = true;
            window.setTimeout(function () {
              try {
                docmeeUI.getCurrentPptInfo();
              } catch (error) {
                console.warn('[super-ppt-editor] getCurrentPptInfo failed', error);
              }
            }, 1200);
          }
        }

        async function openSession(options) {
          var takeover = Boolean(options && options.takeover);
          var silentStatus = Boolean(options && options.silentStatus);
          var result = await requestSession('open', {
            clientId: clientId,
            clientLabel: clientLabel,
            takeover: takeover
          });

          if (result.ok) {
            currentSession = result.payload;
            syncTitle(currentSession);
            buildEditor(currentSession);
            startHeartbeat();
            if (!silentStatus) {
              setStatus(takeover ? '已接管当前 PPT 编辑会话。' : 'Docmee 编辑会话已就绪。', 'info');
              window.setTimeout(hideStatus, 1200);
            }
            return result.payload;
          }

          stopHeartbeat();
          currentSession = null;
          showOverlay(result.payload, takeover ? 'takeover' : 'conflict');
          return null;
        }

        async function sendHeartbeat() {
          var result = await requestSession('heartbeat', {
            clientId: clientId,
            clientLabel: clientLabel
          });

          if (result.ok) {
            if (currentSession) {
              currentSession.expiresAt = result.payload.expiresAt;
              currentSession.leaseExpireAt = result.payload.leaseExpireAt;
            }
            return;
          }

          stopHeartbeat();
          currentSession = null;
          showOverlay(result.payload, 'taken-over');
        }

        function closeSession() {
          if (!jobId || !clientId) {
            return;
          }

          var url = '/api/external-skills/jobs/' + encodeURIComponent(jobId) + '/presentation-session/close';
          var body = JSON.stringify({ clientId: clientId });

          if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
            try {
              var blob = new Blob([body], { type: 'application/json' });
              window.navigator.sendBeacon(url, blob);
              return;
            } catch (error) {
              // ignore sendBeacon failure and fall back to fetch
            }
          }

          void fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: body,
            keepalive: true
          });
        }

        async function boot() {
          if (!jobId) {
            setStatus('缺少 jobId，请从 super-ppt 调试结果页重新打开独立编辑器。', 'error');
            showOverlay({
              code: 'BAD_REQUEST',
              message: '缺少 jobId',
              canTakeover: false
            }, 'invalid');
            primaryActionButton.disabled = true;
            return;
          }

          setStatus('正在创建 Docmee 编辑会话...', 'info');
          await openSession({ takeover: false, silentStatus: true });
        }

        primaryActionButton.addEventListener('click', function () {
          primaryActionButton.disabled = true;
          void openSession({
            takeover: primaryActionButton.textContent === '接管编辑',
            silentStatus: false
          }).finally(function () {
            primaryActionButton.disabled = false;
          });
        });

        secondaryActionButton.addEventListener('click', function () {
          window.location.reload();
        });

        window.addEventListener('pagehide', closeSession);
        window.addEventListener('beforeunload', closeSession);

        void boot().catch(function (error) {
          setStatus(error instanceof Error ? error.message : '独立编辑器初始化失败', 'error');
          showOverlay({
            code: 'INITIALIZATION_FAILED',
            message: error instanceof Error ? error.message : '独立编辑器初始化失败',
            canTakeover: false
          }, 'invalid');
        });
      })();
    </script>
  </body>
</html>`;
}
