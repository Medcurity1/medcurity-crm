// Meddy chat widget — Pulse edition.
// Ported from OG Nexus public/meddy-widget.js with ONLY the transport
// layer changed (Supabase edge functions + Realtime broadcast instead of
// Express + Socket.IO). All UX, styling, capture flows, and AI behavior
// are byte-identical to the live Nexus widget.
//
// Embed:
//   <script defer src="https://crm.medcurity.com/widget/meddy-widget.js"
//     data-api="https://<supabase-project>.supabase.co"
//     data-anon="<supabase anon key>"></script>
(function() {
  'use strict';

  // PULSE PORT: data-api = Supabase project URL; data-anon = the public
  // anon key (needed for the edge function gateway and Realtime).
  // Assets load from wherever this script itself is hosted.
  var _script = document.currentScript;
  var API_URL = (_script && _script.getAttribute('data-api')) || '';
  var ANON_KEY = (_script && _script.getAttribute('data-anon')) || '';
  var FN_URL = API_URL + '/functions/v1/meddy-chat';
  var ASSETS_URL = (function() {
    try { return _script.src.replace(/\/[^\/]*$/, ''); } catch (e) { return ''; }
  })();
  function fnHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (ANON_KEY) { h['apikey'] = ANON_KEY; h['Authorization'] = 'Bearer ' + ANON_KEY; }
    return h;
  }
  function fnPost(action, payload) {
    payload = payload || {};
    payload.action = action;
    return fetch(FN_URL, { method: 'POST', headers: fnHeaders(), body: JSON.stringify(payload) });
  }
  var COLORS = { primary: '#C8102E', dark: '#1B3A5C', lightGray: '#F5F5F5', text: '#333333', white: '#FFFFFF' };

  // Detect which site the widget is loaded on
  var isAppSite = (function() {
    try {
      // Check URL param override first (for test page simulation)
      var siteParam = new URLSearchParams(window.location.search).get('site');
      if (siteParam === 'app') return true;
      if (siteParam === 'main') return false;
    } catch(e) {}
    return window.location.hostname === 'app.medcurity.com' || window.location.hostname === 'www.app.medcurity.com';
  })();

  // Context-aware suggestion pills matched to medcurity.com URL structure
  var CONTEXT_SUGGESTIONS = {
    sra: ['How does the SRA process work?', 'How long does an SRA take?', "What's included in the SRA report?"],
    small: ['Is this right for my small practice?', 'What counts as 1-20 FTEs?', 'How is it different from the full SRA?'],
    training: ['What does HIPAA training cover?', 'How does Medcurity Academy work?', 'Is annual training required?'],
    nva: ['What does an NVA scan for?', 'How often should we do an NVA?', 'Do we need both an SRA and NVA?'],
    vendor: ['How does BAA management work?', 'Can Medcurity track our vendors?', 'What does vendor management include?'],
    safer: ['What is a SAFER Assessment?', 'Is a SAFER Assessment required?', 'How does it relate to HIPAA?'],
    contact: ['What should I expect from a demo?', 'How is Medcurity priced?', 'What size organizations do you work with?'],
    about: ['How long has Medcurity been around?', 'Who does Medcurity work with?', 'What makes Medcurity different?'],
    resources: ['What resources do you offer?', 'Do you have any upcoming webinars?', 'Where can I find compliance guides?']
  };
  var DEFAULT_SUGGESTIONS = ['What does Medcurity do?', 'What is a Security Risk Analysis?', 'How does HIPAA compliance work?'];
  var APP_SUGGESTIONS = ['I have a platform question', 'I need help with my SRA'];

  // State
  var isOpen = false, messages = [], sessionId = '', contactInfo = null, contactShown = false, contactDismissed = false;
  var userMessageCount = 0, successfulResponseCount = 0, consecutiveErrors = 0, greetingShown = false, greetingDismissed = false, isStreaming = false;
  var isTakenOver = false, humanRequested = false, socket = null, visitorTypingTimeout = null;
  var chatLimitReached = false, humanRequestTimeout = null;
  var messageQueue = [];
  var connectionLost = false, disconnectMsgShown = false, intentionalDisconnect = false, disconnectTimer = null;
  var closePromptDismissed = false;
  var WELCOME_MESSAGE = isAppSite
    ? "Hi! I'm Meddy. How can I help with your Medcurity account?"
    : "Hi! I'm Meddy, Medcurity's HIPAA compliance assistant. Ask me anything about HIPAA compliance or our services.";

  // Shadow DOM host and root for CSS isolation
  var shadowHost, shadowRoot;

  function removeTrailingFollowUp(text) {
    if (!text) return text;
    text = text.trim();
    var qIdx = text.lastIndexOf('?');
    if (qIdx === -1 || qIdx < text.length * 0.5) return text;
    var sentStart = 0;
    for (var i = qIdx - 1; i >= 0; i--) {
      if ((text[i] === '.' || text[i] === '!' || text[i] === '?') && i + 1 < text.length && text[i + 1] === ' ') {
        sentStart = i + 2;
        break;
      }
    }
    var lastSentence = text.substring(sentStart, qIdx + 1).trim().toLowerCase();
    var followUpPhrases = [
      'would you like', 'want to know', 'can i help', 'any questions',
      'anything else', 'interested in', 'want me to', 'like to know',
      'shall i', 'do you want', 'need any', 'like more', 'help with anything',
      'want to learn', 'know more about', 'have any questions', 'like me to',
      'need more details', 'want additional', 'like to learn'
    ];
    if (followUpPhrases.some(function(p) { return lastSentence.indexOf(p) !== -1; })) {
      var cleaned = text.substring(0, sentStart).trim();
      return cleaned || text;
    }
    return text;
  }

  function init() {
    try {
      var saved = sessionStorage.getItem('meddy_session');
      if (saved) {
        var data = JSON.parse(saved);
        sessionId = data.sessionId || generateId();
        messages = data.messages || [];
        contactInfo = data.contactInfo || null;
        contactShown = data.contactShown || false;
        contactDismissed = data.contactDismissed || false;
        userMessageCount = data.userMessageCount || 0;
        successfulResponseCount = data.successfulResponseCount || 0;
        consecutiveErrors = data.consecutiveErrors || 0;
        greetingDismissed = data.greetingDismissed || false;
        humanRequested = data.humanRequested || false;
        isTakenOver = data.isTakenOver || false;
        chatLimitReached = data.chatLimitReached || false;
      } else {
        sessionId = generateId();
        messages.push({ role: 'assistant', content: WELCOME_MESSAGE, sender_type: 'welcome' });
      }
    } catch (e) {
      sessionId = generateId();
      messages.push({ role: 'assistant', content: WELCOME_MESSAGE, sender_type: 'welcome' });
    }

    // Ping backend before showing widget - if it fails, don't show anything
    var controller = new AbortController();
    var healthTimeout = setTimeout(function() { controller.abort(); }, 5000);
    fetch(FN_URL, { method: 'POST', headers: fnHeaders(), body: JSON.stringify({ action: 'hours' }), signal: controller.signal })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        clearTimeout(healthTimeout);
        if (data && typeof data.open !== 'undefined') {
          startWidget();
        } else {
          console.warn('Meddy: health check returned unexpected response, widget not loaded');
        }
      })
      .catch(function() {
        clearTimeout(healthTimeout);
        console.warn('Meddy: backend unreachable, widget not loaded');
      });
  }

  function startWidget() {
    // Create Shadow DOM host for CSS isolation
    shadowHost = document.createElement('div');
    shadowHost.id = 'meddy-widget-host';
    shadowHost.style.cssText = 'all:initial;position:fixed;z-index:99997;top:0;left:0;width:0;height:0;pointer-events:none;';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    injectStyles();
    createWidget();
    connectRealtime();
    if (!isAppSite && !greetingDismissed && !isOpen) {
      try {
        setTimeout(function() { if (!isOpen && !greetingDismissed) showGreeting(); }, 5000);
      } catch (e) { console.warn('Meddy: greeting timer error:', e); }
    }
  }

  function generateId() {
    return 'xxxx-xxxx-xxxx'.replace(/x/g, function() { return Math.floor(Math.random() * 16).toString(16); });
  }

  // Stable per-message fingerprint. Generated once when a visitor message is created and
  // carried with the message forever (it persists in the saved session). If the widget ever
  // re-sends the same message, it carries the same fingerprint so the server stores it once.
  var _msgCounter = 0;
  function genMsgCid() {
    _msgCounter++;
    return Date.now().toString(36) + '-' + _msgCounter + '-' + generateId();
  }

  function saveSession() {
    try {
      sessionStorage.setItem('meddy_session', JSON.stringify({
        sessionId: sessionId, messages: messages, contactInfo: contactInfo, contactShown: contactShown,
        contactDismissed: contactDismissed, userMessageCount: userMessageCount, successfulResponseCount: successfulResponseCount,
        consecutiveErrors: consecutiveErrors, greetingDismissed: greetingDismissed,
        humanRequested: humanRequested, isTakenOver: isTakenOver, chatLimitReached: chatLimitReached
      }));
    } catch (e) {}
  }

  function getPageContext() {
    // When simulating a site via ?site= param, return a URL the server will detect correctly
    try {
      var siteParam = new URLSearchParams(window.location.search).get('site');
      if (siteParam === 'app') return 'https://app.medcurity.com/test';
      if (siteParam === 'main') return 'https://medcurity.com/test';
    } catch(e) {}
    return window.location.href;
  }

  function getSuggestions() {
    // App site gets its own pills
    if (isAppSite) return APP_SUGGESTIONS;

    // 1. Check ?page= URL parameter (for test page)
    try {
      var pageParam = new URLSearchParams(window.location.search).get('page');
      if (pageParam && CONTEXT_SUGGESTIONS[pageParam]) return CONTEXT_SUGGESTIONS[pageParam];
    } catch (e) {}

    // 2. Match URL path against medcurity.com structure (specific before general)
    var p = window.location.pathname.toLowerCase();
    if (p.indexOf('small-practice') !== -1 || p.indexOf('sra-for-small') !== -1) return CONTEXT_SUGGESTIONS.small;
    if (p.indexOf('security-risk-analysis') !== -1) return CONTEXT_SUGGESTIONS.sra;
    if (p.indexOf('hipaa-training') !== -1 || p.indexOf('training') !== -1) return CONTEXT_SUGGESTIONS.training;
    if (p.indexOf('network-security') !== -1) return CONTEXT_SUGGESTIONS.nva;
    if (p.indexOf('safer') !== -1) return CONTEXT_SUGGESTIONS.safer;
    if (p.indexOf('vendor') !== -1) return CONTEXT_SUGGESTIONS.vendor;
    if (p.indexOf('explore-medcurity') !== -1) return CONTEXT_SUGGESTIONS.contact;
    if (p.indexOf('contact') !== -1) return CONTEXT_SUGGESTIONS.contact;
    if (p.indexOf('about') !== -1 || p.indexOf('partnership') !== -1) return CONTEXT_SUGGESTIONS.about;
    if (p.indexOf('resource') !== -1 || p.indexOf('blog') !== -1) return CONTEXT_SUGGESTIONS.resources;
    if (p.indexOf('hipaa-compliance-solutions') !== -1) return DEFAULT_SUGGESTIONS;

    // 3. Default (homepage and everything else)
    return DEFAULT_SUGGESTIONS;
  }

  function renderLinks(text) {
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, label, url) {
      // Only explicit http(s)/mailto links become anchors; everything else
      // stays literal text (blocks javascript: and attribute breakout).
      var u = url.replace(/^[\s\u0000-\u001f]+/, '');
      if (!/^(https?:|mailto:)/i.test(u)) return m;
      var safeUrl = u.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" style="color:#1B3A5C;text-decoration:underline;">' + label + '</a>';
    });
  }

  function escapeHtml(text) {
    var div = document.createElement('div'); div.textContent = text;
    return renderLinks(div.innerHTML);
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isBusinessHours() {
    try {
      var now = new Date();
      var pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      var day = pacific.getDay();
      var hour = pacific.getHours();
      return day >= 1 && day <= 5 && hour >= 8 && hour < 17;
    } catch (e) { return true; } // default to open if timezone fails
  }

  // ==================== REALTIME (Supabase) ====================
  // PULSE PORT: replaces Socket.IO. One broadcast channel per session
  // (meddy:conv:<sessionId>); staff/server events arrive as broadcasts
  // with the same names the Socket.IO version used. Visitor typing goes
  // out on the same channel (client-to-client, no server hop).

  var sbClient = null, sbChannel = null;

  function rtSend(event, payload) {
    try { if (sbChannel) sbChannel.send({ type: 'broadcast', event: event, payload: payload || {} }); } catch (e) {}
  }

  function handleRtMessage(msg) {
    if (!msg) return;
    var st = msg.senderType || msg.sender_type || (msg.role === 'human' ? 'employee' : 'system');
    if (st === 'employee' || st === 'system') {
      messages.push({ role: msg.role || 'assistant', content: msg.content, sender_type: st, sender_name: msg.senderName || msg.sender_name });
      addMessageBubble(st, msg.content, msg.senderName || msg.sender_name);
      if (st === 'system' && (msg.content.indexOf('team know') !== -1 || msg.content.indexOf('will be with you') !== -1)) {
        humanRequested = true;
        syncHumanLinkVisibility();
      }
      saveSession();
    }
  }

  function subscribeChannel() {
    if (!sbClient) return;
    if (sbChannel) { try { sbClient.removeChannel(sbChannel); } catch (e) {} sbChannel = null; }
    var ch = sbClient.channel('meddy:conv:' + sessionId, { config: { broadcast: { self: false } } });
    sbChannel = ch;
    ch
      .on('broadcast', { event: 'new-message' }, function(e) { handleRtMessage(e.payload); })
      .on('broadcast', { event: 'taken-over' }, function() {
        isTakenOver = true; clearTimeout(humanRequestTimeout); humanRequestTimeout = null;
        if (suggestionsEl) suggestionsEl.innerHTML = ''; syncHumanLinkVisibility(); saveSession();
      })
      .on('broadcast', { event: 'show-form' }, function() {
        if (!contactInfo) { contactShown = false; showContactForm('agent_requested'); }
      })
      .on('broadcast', { event: 'agents-unavailable' }, function() {
        if (humanRequested && !isTakenOver && humanRequestTimeout) {
          clearTimeout(humanRequestTimeout);
          humanRequestTimeout = null;
          if (!contactInfo) {
            contactShown = false;
            var busyMsg = "Our team isn't available right now. Leave your info and someone will follow up.";
            messages.push({ role: 'assistant', content: busyMsg, sender_type: 'system' });
            addMessageBubble('system', busyMsg);
            saveSession();
            setTimeout(function() { showContactForm('human_offhours'); }, 300);
          }
        }
      })
      .on('broadcast', { event: 'employee-typing' }, function(e) { showEmployeeTyping(e.payload && e.payload.name); })
      .on('broadcast', { event: 'employee-stop-typing' }, function() { hideEmployeeTyping(); })
      .on('broadcast', { event: 'ai-typing' }, function() { showAiTypingIndicator(); })
      .on('broadcast', { event: 'ai-typing-stop' }, function() { hideAiTypingIndicator(); })
      .subscribe(function(status) {
        if (ch !== sbChannel) return; // stale channel from an end/reset swap
        if (status === 'SUBSCRIBED') {
          if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
          if (intentionalDisconnect) {
            intentionalDisconnect = false;
            connectionLost = false;
            disconnectMsgShown = false;
            return;
          }
          if (disconnectMsgShown) {
            disconnectMsgShown = false;
            connectionLost = false;
            if (!chatLimitReached) {
              inputEl.disabled = false;
              inputEl.placeholder = 'Ask about HIPAA compliance...';
              panelEl.querySelector('.meddy-send').disabled = false;
            }
            for (var ri = messages.length - 1; ri >= 0; ri--) {
              if (messages[ri].sender_type === 'system' && messages[ri].content.indexOf('Connection lost') !== -1) {
                messages.splice(ri, 1); break;
              }
            }
            var lostBubbles = messagesEl.querySelectorAll('.meddy-msg-system');
            for (var bi = lostBubbles.length - 1; bi >= 0; bi--) {
              if (lostBubbles[bi].textContent.indexOf('Connection lost') !== -1) {
                lostBubbles[bi].parentNode.removeChild(lostBubbles[bi]); break;
              }
            }
            var reconnDiv = addMessageBubble('system', 'Reconnected');
            reconnDiv.style.transition = 'opacity 0.5s ease';
            setTimeout(function() {
              reconnDiv.style.opacity = '0';
              setTimeout(function() {
                if (reconnDiv.parentNode) reconnDiv.parentNode.removeChild(reconnDiv);
                for (var mi = messages.length - 1; mi >= 0; mi--) {
                  if (messages[mi].sender_type === 'system' && messages[mi].content === 'Reconnected') {
                    messages.splice(mi, 1); break;
                  }
                }
                saveSession();
              }, 500);
            }, 3000);
            saveSession();
          } else {
            connectionLost = false;
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (intentionalDisconnect) return;
          connectionLost = true;
          if (!disconnectTimer && !disconnectMsgShown) {
            disconnectTimer = setTimeout(function() {
              disconnectTimer = null;
              if (connectionLost && !disconnectMsgShown) {
                disconnectMsgShown = true;
                var lostMsg = 'Connection lost. You can reach us at medcurity.com/contact or (509) 867-3645.';
                messages.push({ role: 'assistant', content: lostMsg, sender_type: 'system' });
                addMessageBubble('system', lostMsg);
                inputEl.disabled = true;
                inputEl.placeholder = 'Connection lost...';
                panelEl.querySelector('.meddy-send').disabled = true;
                saveSession();
              }
            }, 30000);
          }
        }
      });
  }

  function connectRealtime() {
    if (!API_URL || !ANON_KEY) { console.warn('Meddy: realtime not configured (data-api / data-anon)'); return; }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    script.onload = function() {
      try {
        sbClient = window.supabase.createClient(API_URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 5 } } });
        subscribeChannel();
      } catch (e) { console.warn('Meddy: realtime init failed', e); }
    };
    script.onerror = function() { console.warn('Meddy: could not load realtime client'); };
    document.head.appendChild(script);
  }

  // ==================== STYLES ====================

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = '' +
      // CSS reset — prevent host page styles from leaking into widget
      ':host{all:initial;position:fixed;z-index:99997;pointer-events:none;}' +
      ':host *,:host *::before,:host *::after{box-sizing:border-box;}' +
      // Bubble with logo
      '.meddy-bubble{position:fixed;bottom:24px;right:24px;width:64px;height:64px;border-radius:50%;background:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.04);display:flex;align-items:center;justify-content:center;z-index:99998;transition:transform 0.2s,box-shadow 0.2s;border:none;outline:none;padding:0;overflow:hidden;font-family:system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;pointer-events:auto;}' +
      '.meddy-bubble:hover{transform:scale(1.08);box-shadow:0 6px 20px rgba(0,0,0,0.22),0 0 0 1px rgba(0,0,0,0.04);}' +
      '.meddy-bubble img{width:58px;height:58px;border-radius:50%;object-fit:cover;}' +
      '.meddy-bubble.meddy-pulse{animation:meddy-pulse-anim 2s ease-in-out 3;}' +
      '@keyframes meddy-pulse-anim{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,0.18);}50%{box-shadow:0 4px 16px rgba(200,16,46,0.5),0 0 0 8px rgba(200,16,46,0.15);}}' +
      // Greeting popup with speech-bubble tail
      '.meddy-greeting{position:fixed;bottom:96px;right:24px;background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 4px 24px rgba(0,0,0,0.12);z-index:99997;max-width:280px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:' + COLORS.text + ';line-height:1.45;opacity:0;transform:translateY(8px);transition:opacity 0.35s ease,transform 0.35s ease;pointer-events:auto;}' +
      '.meddy-greeting.meddy-visible{opacity:1;transform:translateY(0);}' +
      '.meddy-greeting::after{content:"";position:absolute;bottom:-8px;right:30px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid #fff;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.06));}' +
      '.meddy-greeting-close{position:absolute;top:4px;right:4px;background:none;border:none;font-size:18px;cursor:pointer;color:#999;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:background 0.15s,color 0.15s;line-height:1;}.meddy-greeting-close:hover{background:#f0f0f0;color:#555;}' +
      // Panel
      '.meddy-panel{position:fixed;bottom:24px;right:24px;width:380px;height:520px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.18);z-index:99999;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(20px) scale(0.95);transition:opacity 0.25s ease,transform 0.25s ease;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:' + COLORS.text + ';font-size:14px;line-height:1.45;}' +
      '.meddy-panel.meddy-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto !important;}' +
      // Header with gradient
      '.meddy-header{background:linear-gradient(135deg,#1B3A5C 0%,#243f5f 100%);color:#fff;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}' +
      '.meddy-header-text{display:flex;align-items:center;gap:8px;}' +
      '.meddy-header-icon{width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}' +
      '.meddy-header-icon img{width:28px;height:28px;border-radius:6px;object-fit:cover;}' +
      '.meddy-header-info h3{margin:0;font-size:16px;font-weight:600;}.meddy-header-info p{margin:2px 0 0;font-size:11px;opacity:0.7;}' +
      '.meddy-header-actions{display:flex;align-items:center;gap:4px;}' +
      '.meddy-human-confirm{position:absolute;top:100%;right:0;margin-top:6px;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.18);padding:14px 16px 12px;width:185px;z-index:10;color:#333;font-size:13px;line-height:1.45;text-align:center;}' +
      '.meddy-human-confirm::before{content:"";position:absolute;top:-6px;right:10px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:6px solid #fff;}' +
      '.meddy-human-confirm p{margin:0 0 12px;font-weight:600;color:#1B3A5C;}' +
      '.meddy-human-confirm-yes{background:#C8102E;color:#fff;border:none;padding:8px 0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;width:100%;font-family:system-ui,-apple-system,sans-serif;transition:background 0.15s;box-shadow:0 2px 6px rgba(200,16,46,0.25);}.meddy-human-confirm-yes:hover{background:#a00d24;}' +
      '.meddy-human-confirm-cancel{display:block;width:100%;text-align:center;margin-top:8px;padding:4px 0;font-size:12px;color:#999;cursor:pointer;background:none;border:none;font-family:system-ui,-apple-system,sans-serif;}.meddy-human-confirm-cancel:hover{color:#555;}' +
      '.meddy-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px 8px;opacity:0.7;transition:opacity 0.15s;}.meddy-close:hover{opacity:1;}' +
      '.meddy-header-menu{cursor:pointer;padding:6px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background 0.15s;position:relative;background:none;border:none;}.meddy-header-menu:hover{background:rgba(255,255,255,0.15);}' +
      '.meddy-end-confirm-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:20;display:flex;align-items:center;justify-content:center;border-radius:14px;}' +
      '.meddy-end-confirm-box{background:#fff;border-radius:14px;padding:20px 22px 16px;box-shadow:0 12px 36px rgba(0,0,0,0.22);max-width:225px;width:88%;text-align:center;}' +
      '.meddy-end-confirm-box p{margin:0 0 14px;font-size:14px;font-weight:600;color:#1B3A5C;line-height:1.45;}' +
      '.meddy-end-confirm-yes{background:#C8102E;color:#fff;border:none;padding:9px 0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;width:100%;font-family:system-ui,-apple-system,sans-serif;transition:background 0.15s;box-shadow:0 2px 6px rgba(200,16,46,0.25);}.meddy-end-confirm-yes:hover{background:#a00d24;}' +
      '.meddy-end-confirm-cancel{display:block;text-align:center;margin-top:8px;font-size:12px;color:#888;cursor:pointer;background:none;border:none;font-family:system-ui,-apple-system,sans-serif;width:100%;padding:4px;}.meddy-end-confirm-cancel:hover{color:#555;}' +
      // Messages area with fade-in
      '.meddy-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;animation:meddy-fade-in 0.15s ease;}' +
      '@keyframes meddy-fade-in{from{opacity:0;}to{opacity:1;}}' +
      // Message bubbles with shadows
      '.meddy-msg{max-width:85%;padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.45;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,0.06);}' +
      '.meddy-msg-user{align-self:flex-end;background:' + COLORS.primary + ';color:#fff;border-bottom-right-radius:4px;}' +
      '.meddy-msg-assistant{align-self:flex-start;background:' + COLORS.lightGray + ';color:' + COLORS.text + ';border-bottom-left-radius:4px;}' +
      '.meddy-msg-assistant a{color:' + COLORS.dark + ';text-decoration:underline;}' +
      '.meddy-msg-employee{align-self:flex-start;background:' + COLORS.lightGray + ';color:' + COLORS.text + ';border-bottom-left-radius:4px;}' +
      '.meddy-msg-system{align-self:center;font-size:12px;color:#888;font-style:italic;text-align:center;padding:6px 12px;max-width:100%;border-radius:8px;background:none;box-shadow:none;}' +
      '.meddy-system-waiting{background:#eef4ff;color:#3b6fb5;border:1px solid #d0e0f5;}' +
      '.meddy-system-connected{background:#edf7ed;color:#3a7d3a;border:1px solid #c8e6c8;}' +
      '.meddy-sender-label{font-size:11px;font-weight:600;color:' + COLORS.dark + ';margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;}' +
      // Suggestion pills with primary color accent
      '.meddy-suggestions{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 12px;}' +
      '.meddy-pill{background:#fff;border:1px solid rgba(200,16,46,0.2);border-radius:20px;padding:8px 14px;font-size:13px;cursor:pointer;color:' + COLORS.text + ';transition:all 0.2s ease;font-family:system-ui,-apple-system,sans-serif;line-height:1.3;box-shadow:0 1px 3px rgba(0,0,0,0.04);}' +
      '.meddy-pill:hover{border-color:' + COLORS.primary + ';background:#fef2f2;color:' + COLORS.primary + ';box-shadow:0 2px 6px rgba(200,16,46,0.1);transform:translateY(-1px);}' +
      // Contact card
      '.meddy-contact-card{margin:0 16px 12px;border-radius:10px;border:1px solid #dde2e8;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;background:#fff;}' +
      '.meddy-contact-hdr{background:linear-gradient(135deg,#1B3A5C 0%,#243f5f 100%);color:#fff;padding:10px 14px;font-size:13px;line-height:1.4;}' +
      '.meddy-contact-body{padding:12px 14px;}' +
      '.meddy-contact-body input{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;margin-bottom:6px;font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box;transition:border-color 0.15s;}' +
      '.meddy-contact-body input:focus{outline:none;border-color:' + COLORS.dark + ';}' +
      '.meddy-contact-body input.meddy-input-error{border-color:#C8102E;}' +
      '.meddy-email-error{color:#C8102E;font-size:11px;margin-top:-2px;margin-bottom:6px;display:none;}' +
      '.meddy-contact-btns{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:4px;}' +
      '.meddy-contact-send{background:' + COLORS.primary + ';color:#fff;border:none;padding:8px 0;border-radius:6px;font-size:13px;cursor:pointer;width:100%;transition:background 0.15s;}.meddy-contact-send:hover{background:#a00d24;}' +
      '.meddy-contact-skip{background:none;border:none;color:#888;font-size:11px;cursor:pointer;text-decoration:underline;padding:2px;}' +
      // Input area with shadow separator
      '.meddy-input-area{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee;box-shadow:0 -2px 8px rgba(0,0,0,0.03);flex-shrink:0;align-items:flex-end;}' +
      '.meddy-input{flex:1;padding:10px 14px;border:1px solid #ddd;border-radius:20px;font-size:14px;resize:none;font-family:system-ui,-apple-system,sans-serif;line-height:1.4;max-height:80px;outline:none;overflow-y:auto;transition:border-color 0.15s;}.meddy-input:focus{border-color:' + COLORS.dark + ';}' +
      '.meddy-send{background:' + COLORS.primary + ';border:none;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.2s,transform 0.15s;}.meddy-send:hover{background:#a00d24;transform:scale(1.05);}.meddy-send:disabled{background:#ccc;cursor:default;transform:none;}' +
      '.meddy-send svg{width:16px;height:16px;fill:#fff;}' +
      // Footer - very muted
      '.meddy-footer-row{display:flex;align-items:center;justify-content:center;gap:8px;padding:3px 12px 7px;flex-shrink:0;position:relative;}' +
      '.meddy-footer-human{color:#777;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;font-family:system-ui,-apple-system,sans-serif;}.meddy-footer-human:hover{color:#1B3A5C;}' +
      '.meddy-footer-dot{color:#ccc;font-size:12px;}' +
      '.meddy-footer-credit{color:#b5b5b5;font-size:11px;text-decoration:none;font-family:system-ui,-apple-system,sans-serif;}.meddy-footer-credit:hover{color:#999;}' +
      '.meddy-confirm-up{bottom:calc(100% + 8px);top:auto;right:50%;transform:translateX(50%);}' +
      '.meddy-confirm-up::before{top:auto;bottom:-6px;right:50%;margin-right:-6px;border-bottom:none;border-top:6px solid #fff;}' +
      '.meddy-resize{position:absolute;top:0;left:0;width:20px;height:20px;cursor:nwse-resize;z-index:5;pointer-events:none;touch-action:none;}' +
      '.meddy-panel.meddy-open .meddy-resize{pointer-events:auto;}' +
      '.meddy-resize::after{content:"";position:absolute;top:5px;left:5px;width:8px;height:8px;border-top:2px solid rgba(255,255,255,0.55);border-left:2px solid rgba(255,255,255,0.55);border-radius:2px 0 0 0;}' +
            // Typing indicator with red dots
      '.meddy-typing-wrap{align-self:flex-start;display:flex;flex-direction:column;gap:2px;}' +
      '.meddy-typing-label{font-size:11px;color:#888;font-style:italic;padding-left:4px;}' +
      '.meddy-typing{display:flex;gap:5px;padding:10px 14px;background:' + COLORS.lightGray + ';border-radius:18px;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,0.06);}' +
      '.meddy-typing span{width:7px;height:7px;background:' + COLORS.primary + ';border-radius:50%;animation:meddy-bounce 1.4s ease-in-out infinite;}' +
      '.meddy-typing span:nth-child(2){animation-delay:0.2s;}.meddy-typing span:nth-child(3){animation-delay:0.4s;}' +
      '@keyframes meddy-bounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-5px);}}' +
      '.meddy-employee-typing{font-size:12px;color:#888;font-style:italic;padding:0 16px 4px;flex-shrink:0;}' +
      '.meddy-reset-wrap{text-align:center;padding:8px 16px;}.meddy-reset-btn{background:none;border:1px solid #ddd;border-radius:20px;padding:8px 16px;font-size:13px;cursor:pointer;color:#888;font-family:system-ui,-apple-system,sans-serif;transition:all 0.15s;}.meddy-reset-btn:hover{border-color:' + COLORS.primary + ';color:' + COLORS.primary + ';}' +
      '.meddy-rate-notice{padding:8px 16px;background:#fff3cd;color:#856404;font-size:12px;text-align:center;border-top:1px solid #ffc107;flex-shrink:0;}' +
      '.meddy-char-count{padding:0 16px 2px;font-size:11px;text-align:right;flex-shrink:0;transition:color 0.15s;color:#aaa;}' +
      '.meddy-char-count.meddy-char-warn{color:#C8102E;font-weight:600;}' +
      // Slim inline lead capture bar
      '.meddy-slim-bar{margin:4px 0;padding:8px 12px;background:#fafafa;border:1px solid #e8e8e8;border-radius:14px;font-family:system-ui,-apple-system,sans-serif;}' +
      '.meddy-slim-label{font-size:11px;color:#888;margin-bottom:6px;}' +
      '.meddy-slim-row{display:flex;gap:6px;align-items:center;}' +
      '.meddy-slim-row input{flex:1;min-width:0;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:system-ui,-apple-system,sans-serif;outline:none;transition:border-color 0.15s;box-sizing:border-box;}.meddy-slim-row input:focus{border-color:#1B3A5C;}.meddy-slim-row input.meddy-input-error{border-color:#C8102E;}' +
      '.meddy-slim-send{background:#C8102E;border:none;width:30px;height:30px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;}.meddy-slim-send:hover{background:#a00d24;}.meddy-slim-send svg{width:13px;height:13px;fill:#fff;}' +
      '.meddy-slim-close{background:none;border:none;color:#bbb;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;transition:color 0.15s;}.meddy-slim-close:hover{color:#666;}' +
      '.meddy-slim-thanks{font-size:13px;color:#1B3A5C;font-weight:500;padding:2px 0;text-align:center;transition:opacity 0.5s ease;}' +
      '@media(max-width:640px){.meddy-panel{width:100% !important;height:calc(100vh - 80px) !important;bottom:0;right:0;border-radius:14px 14px 0 0;}.meddy-resize{display:none;}.meddy-bubble{bottom:16px;right:16px;}.meddy-greeting{right:16px;bottom:88px;max-width:calc(100vw - 90px);}.meddy-footer-row{padding:2px 10px 5px;gap:6px;}.meddy-footer-human{font-size:11px;}.meddy-footer-credit{font-size:10px;}.meddy-slim-row{flex-wrap:wrap;}.meddy-slim-row input{flex:1 1 100%;}.meddy-slim-row .meddy-slim-send,.meddy-slim-row .meddy-slim-close{flex:0 0 auto;}}';
    shadowRoot.appendChild(style);
  }

  // ==================== CREATE WIDGET ====================

  var bubbleEl, panelEl, messagesEl, inputEl, suggestionsEl, greetingEl, contactEl, employeeTypingEl;

  function createWidget() {
    bubbleEl = document.createElement('button');
    bubbleEl.className = 'meddy-bubble';
    bubbleEl.setAttribute('aria-label', 'Open chat');
    bubbleEl.setAttribute('title', 'Chat with us');
    bubbleEl.innerHTML = '<img src="' + ASSETS_URL + '/meddy-logo.png?v=3" alt="Chat with Meddy">';
    bubbleEl.addEventListener('click', togglePanel);
    shadowRoot.appendChild(bubbleEl);

    greetingEl = document.createElement('div');
    greetingEl.className = 'meddy-greeting';
    greetingEl.innerHTML = 'Questions about HIPAA compliance? I can help.<button class="meddy-greeting-close">&times;</button>';
    greetingEl.querySelector('.meddy-greeting-close').addEventListener('click', function(e) { e.stopPropagation(); dismissGreeting(); });
    greetingEl.addEventListener('click', function() { dismissGreeting(); openPanel(); });
    shadowRoot.appendChild(greetingEl);

    panelEl = document.createElement('div');
    panelEl.className = 'meddy-panel';
    panelEl.innerHTML = '' +
      '<div class="meddy-header"><div class="meddy-header-text"><div class="meddy-header-icon"><img src="' + ASSETS_URL + '/meddy-logo-header.png?v=5" alt="Meddy"></div><div class="meddy-header-info"><h3>Meddy</h3><p>HIPAA Compliance Assistant</p></div></div><div class="meddy-header-actions"><button class="meddy-header-menu" id="meddy-end-btn" title="End conversation"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2"/><line x1="5.8" y1="5.8" x2="18.2" y2="18.2" stroke="rgba(255,255,255,0.7)" stroke-width="2"/></svg></button><button class="meddy-close" title="Minimize chat"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 9l7 7 7-7"/></svg></button></div></div>' +
      '<div class="meddy-messages"></div>' +
      '<div class="meddy-suggestions-wrap"></div>' +
      '<div class="meddy-contact-wrap"></div>' +
      '<div class="meddy-employee-typing" style="display:none;"></div>' +
      '<div class="meddy-char-count" id="meddy-char-count" style="display:none;"></div>' +
      '<div class="meddy-input-area"><textarea class="meddy-input" placeholder="Ask about HIPAA compliance..." rows="1"></textarea><button class="meddy-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div>' +
      '<div class="meddy-footer-row"><a id="meddy-talk-human-footer" class="meddy-footer-human">Talk to a human</a><span class="meddy-footer-dot">&middot;</span><a class="meddy-footer-credit" href="https://medcurity.com" target="_blank" rel="noopener">Powered by Medcurity</a></div>';

    panelEl.querySelector('.meddy-close').addEventListener('click', closePanel);
    messagesEl = panelEl.querySelector('.meddy-messages');
    suggestionsEl = panelEl.querySelector('.meddy-suggestions-wrap');
    contactEl = panelEl.querySelector('.meddy-contact-wrap');
    employeeTypingEl = panelEl.querySelector('.meddy-employee-typing');
    inputEl = panelEl.querySelector('.meddy-input');
    var sendBtn = panelEl.querySelector('.meddy-send');

    inputEl.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    inputEl.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 80) + 'px';
      // Character counter
      var charCountEl = panelEl.querySelector('#meddy-char-count');
      var len = this.value.length;
      if (len > 400) {
        charCountEl.style.display = 'block';
        charCountEl.textContent = len + '/500';
        charCountEl.className = 'meddy-char-count' + (len > 500 ? ' meddy-char-warn' : '');
      } else {
        charCountEl.style.display = 'none';
      }
      rtSend('visitor-typing', {});
      clearTimeout(visitorTypingTimeout);
      visitorTypingTimeout = setTimeout(function() { rtSend('visitor-stop-typing', {}); }, 5000);
    });
    sendBtn.addEventListener('click', sendMessage);
    panelEl.querySelector('#meddy-end-btn').addEventListener('click', function(e) { e.stopPropagation(); showEndConfirm(); });
    panelEl.querySelector('#meddy-talk-human-footer').addEventListener('click', function(e) { e.stopPropagation(); showHumanConfirm(); });
    initResizeHandle();
    syncHumanLinkVisibility();
    shadowRoot.appendChild(panelEl);
    renderMessages();
    renderSuggestions();
    if (chatLimitReached) {
      inputEl.disabled = true;
      inputEl.placeholder = 'Chat limit reached - contact us at medcurity.com/contact';
      panelEl.querySelector('.meddy-send').disabled = true;
    }
  }

  function initResizeHandle() {
    var handle = document.createElement('div');
    handle.className = 'meddy-resize';
    handle.title = 'Drag to resize';
    panelEl.appendChild(handle);
    // Restore saved size (clamped to current viewport).
    try {
      var saved = JSON.parse(localStorage.getItem('meddy_panel_size') || 'null');
      if (saved && saved.w && saved.h) applyPanelSize(saved.w, saved.h);
    } catch (e) {}
    var startX, startY, startW, startH, resizing = false;
    handle.addEventListener('pointerdown', function(e) {
      if (!isOpen) return;
      e.preventDefault();
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = panelEl.offsetWidth; startH = panelEl.offsetHeight;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    handle.addEventListener('pointermove', function(e) {
      if (!resizing) return;
      applyPanelSize(startW + (startX - e.clientX), startH + (startY - e.clientY));
    });
    function endResize() {
      if (!resizing) return;
      resizing = false;
      try {
        localStorage.setItem('meddy_panel_size', JSON.stringify({ w: panelEl.offsetWidth, h: panelEl.offsetHeight }));
      } catch (e) {}
    }
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
  }

  function syncHumanLinkVisibility() {
    if (!panelEl) return;
    // Hide only the link + dot; "Powered by Medcurity" stays.
    var display = (humanRequested || isTakenOver) ? 'none' : '';
    var link = panelEl.querySelector('.meddy-footer-human');
    var dot = panelEl.querySelector('.meddy-footer-dot');
    if (link) link.style.display = display;
    if (dot) dot.style.display = display;
  }

  function applyPanelSize(w, h) {
    var maxW = Math.min(600, window.innerWidth - 48);
    var maxH = Math.min(Math.round(window.innerHeight * 0.88), 780);
    w = Math.max(300, Math.min(maxW, w));
    h = Math.max(360, Math.min(maxH, h));
    panelEl.style.width = w + 'px';
    panelEl.style.height = h + 'px';
  }

  function showGreeting() {
    if (greetingShown || greetingDismissed) return;
    greetingShown = true;
    bubbleEl.classList.add('meddy-pulse');
    setTimeout(function() { greetingEl.classList.add('meddy-visible'); }, 100);
    // Dismiss on outside click
    setTimeout(function() {
      document.addEventListener('click', greetingOutsideClick);
    }, 200);
  }

  function greetingOutsideClick(e) {
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(greetingEl) !== -1 || path.indexOf(bubbleEl) !== -1) return;
    dismissGreeting();
  }

  function dismissGreeting() {
    greetingDismissed = true;
    greetingEl.classList.remove('meddy-visible');
    bubbleEl.classList.remove('meddy-pulse');
    document.removeEventListener('click', greetingOutsideClick);
    saveSession();
  }

  function togglePanel() { if (isOpen) closePanel(); else openPanel(); }
  function openPanel() { isOpen = true; dismissGreeting(); hideCloseCapture(); panelEl.classList.add('meddy-open'); bubbleEl.style.display = 'none'; inputEl.focus(); scrollToBottom(); }
  function closePanel() {
    // If capture form is already showing, treat second X click as "No thanks"
    if (shadowRoot.getElementById('meddy-close-capture')) {
      closePromptDismissed = true;
      doClosePanel();
      return;
    }
    // Show soft capture prompt if: has sent messages, no contact info yet, not already dismissed
    if (userMessageCount > 0 && !contactInfo && !closePromptDismissed) {
      showCloseCapture();
      return;
    }
    doClosePanel();
  }
  function doClosePanel() {
    hideCloseCapture();
    isOpen = false;
    panelEl.classList.remove('meddy-open');
    bubbleEl.style.display = 'flex';
  }

  function renderMessages() {
    messagesEl.innerHTML = '';
    messages.forEach(function(msg) {
      var st = msg.sender_type || msg.role;
      if (st === 'user' || st === 'visitor') st = 'user';
      else if (st === 'employee') st = 'employee';
      else if (st === 'system') st = 'system';
      else st = 'assistant'; // covers 'welcome' and 'ai' too
      addMessageBubble(st, msg.content, msg.sender_name, true);
    });
    scrollToBottom();
  }

  function addMessageBubble(senderType, content, senderName, skipScroll) {
    var div = document.createElement('div');
    if (senderType === 'system') {
      div.className = 'meddy-msg meddy-msg-system';
      if (content.indexOf('connected with') !== -1) div.className += ' meddy-system-connected';
      else if (content.indexOf('team know') !== -1 || content.indexOf('will be with you') !== -1) div.className += ' meddy-system-waiting';
      div.textContent = content;
    }
    else if (senderType === 'employee') { div.className = 'meddy-msg meddy-msg-employee'; div.innerHTML = '<div class="meddy-sender-label">' + escapeHtml(senderName || 'Medcurity Team') + '</div>' + escapeHtml(content); }
    else if (senderType === 'user') { div.className = 'meddy-msg meddy-msg-user'; div.textContent = content; }
    else { div.className = 'meddy-msg meddy-msg-assistant'; div.innerHTML = escapeHtml(content); }
    messagesEl.appendChild(div);
    if (!skipScroll) scrollToBottom();
    return div;
  }

  function renderSuggestions() {
    var hasUserMessages = messages.some(function(m) { return m.role === 'user'; });
    if (hasUserMessages) { suggestionsEl.innerHTML = ''; return; }
    var suggestions = getSuggestions() || DEFAULT_SUGGESTIONS;
    if (!suggestions || !suggestions.length) { suggestionsEl.innerHTML = ''; return; }
    var html = '<div class="meddy-suggestions">';
    suggestions.forEach(function(s) { html += '<button class="meddy-pill">' + s + '</button>'; });
    html += '</div>';
    suggestionsEl.innerHTML = html;
    suggestionsEl.querySelectorAll('.meddy-pill').forEach(function(btn) {
      btn.addEventListener('click', function() { inputEl.value = btn.textContent; sendMessage(); });
    });
  }

  // Slim inline capture bar (soft capture only — 3rd message trigger)
  function showSlimCaptureBar() {
    if (contactInfo || contactShown || contactDismissed || isTakenOver || humanRequested) return;
    contactShown = true;
    saveSession();
    var bar = document.createElement('div');
    bar.className = 'meddy-slim-bar';
    bar.innerHTML = '<div class="meddy-slim-label">Want personalized follow-up? Share your info.</div>' +
      '<div class="meddy-slim-row">' +
        '<input type="text" class="meddy-slim-name" placeholder="Name">' +
        '<input type="email" class="meddy-slim-email" placeholder="Email">' +
        '<button class="meddy-slim-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>' +
        '<button class="meddy-slim-close" aria-label="Dismiss">&times;</button>' +
      '</div>';
    messagesEl.appendChild(bar);
    scrollToBottom();
    bar.querySelector('.meddy-slim-close').addEventListener('click', function() {
      contactDismissed = true;
      bar.remove();
      saveSession();
    });
    bar.querySelector('.meddy-slim-send').addEventListener('click', function() {
      var nameInput = bar.querySelector('.meddy-slim-name');
      var emailInput = bar.querySelector('.meddy-slim-email');
      var name = nameInput.value.trim();
      var email = emailInput.value.trim();
      if (!name) { nameInput.classList.add('meddy-input-error'); return; }
      if (!email || !isValidEmail(email)) { emailInput.classList.add('meddy-input-error'); return; }
      contactInfo = { name: name, email: email, organization: '', phone: '' };
      saveSession();
      fnPost('contact', { sessionId: sessionId, name: name, email: email, organization: '', phone: '' })
        .catch(function(err) { console.error('Meddy: Failed to save contact:', err); });
      bar.innerHTML = '<div class="meddy-slim-thanks">Thanks, ' + escapeHtml(name) + '!</div>';
      setTimeout(function() {
        bar.style.transition = 'opacity 0.5s ease';
        bar.style.opacity = '0';
        setTimeout(function() { bar.remove(); }, 500);
      }, 3000);
    });
    bar.querySelector('.meddy-slim-name').addEventListener('input', function() { this.classList.remove('meddy-input-error'); });
    bar.querySelector('.meddy-slim-email').addEventListener('input', function() { this.classList.remove('meddy-input-error'); });
  }

  // Unified contact form for all scenarios
  // reason: 'soft' | 'limit' | 'human_hours' | 'human_offhours' | 'human_timeout' | 'agent_requested' | 'app_identify'
  function showContactForm(reason) {
    // Never show if we already have contact info
    if (contactInfo) {
      if (reason === 'limit') disableChatInput();
      return;
    }
    // Soft/app_identify capture has stricter guards
    if ((reason === 'soft' || reason === 'app_identify') && (contactShown || contactDismissed || isTakenOver || humanRequested)) return;
    // Human/timeout reasons skip if already dismissed
    if (reason !== 'soft' && reason !== 'limit' && reason !== 'app_identify' && contactDismissed) return;

    contactShown = true;
    saveSession();

    var headerMessages = {
      soft: "If you'd like someone from our team to follow up, share your info below.",
      limit: "Our team would love to continue this conversation with you.",
      human_hours: "Share your info so we can connect you with the right person.",
      human_offhours: "Our team is available Mon-Fri, 8 AM - 5 PM Pacific. Leave your info and we'll reach out.",
      human_timeout: "Our team is currently busy. Leave your info and someone will get back to you shortly.",
      agent_requested: "Please share your contact info below.",
      app_identify: "Share your info below so we can better assist you."
    };

    contactEl.innerHTML = '' +
      '<div class="meddy-contact-card">' +
        '<div class="meddy-contact-hdr">' + (headerMessages[reason] || headerMessages.soft) + '</div>' +
        '<div class="meddy-contact-body">' +
          '<input type="text" class="meddy-contact-name" placeholder="Full Name" required>' +
          '<input type="email" class="meddy-contact-email" placeholder="Email" required>' +
          '<div class="meddy-email-error">Please enter a valid email address</div>' +
          '<input type="text" class="meddy-contact-org" placeholder="Organization" required>' +
          '<input type="tel" class="meddy-contact-phone" placeholder="Phone (optional)">' +
          '<div class="meddy-contact-btns"><button class="meddy-contact-send">Send</button><button class="meddy-contact-skip">No thanks</button></div>' +
        '</div>' +
      '</div>';

    contactEl.querySelector('.meddy-contact-send').addEventListener('click', function() {
      var name = contactEl.querySelector('.meddy-contact-name').value.trim();
      var email = contactEl.querySelector('.meddy-contact-email').value.trim();
      var org = contactEl.querySelector('.meddy-contact-org').value.trim();
      var phone = contactEl.querySelector('.meddy-contact-phone').value.trim();
      var emailInput = contactEl.querySelector('.meddy-contact-email');
      var errorEl = contactEl.querySelector('.meddy-email-error');
      if (!name) { contactEl.querySelector('.meddy-contact-name').classList.add('meddy-input-error'); return; }
      if (!email) { emailInput.classList.add('meddy-input-error'); errorEl.style.display = 'block'; return; }
      if (!isValidEmail(email)) { emailInput.classList.add('meddy-input-error'); errorEl.style.display = 'block'; return; }
      if (!org) { contactEl.querySelector('.meddy-contact-org').classList.add('meddy-input-error'); return; }
      contactInfo = { name: name, email: email, organization: org, phone: phone };
      contactEl.innerHTML = '';
      saveSession();
      // Send contact info to server
      fnPost('contact', { sessionId: sessionId, name: name, email: email, organization: org, phone: phone })
        .catch(function(err) { console.error('Meddy: Failed to save contact:', err); });
      var thanksMsg = reason === 'agent_requested'
        ? 'Thanks, ' + name + "! We've got your info."
        : reason === 'app_identify'
        ? 'Thanks, ' + name + '! We can see your account now.'
        : 'Thanks, ' + name + '! Someone from our team will be in touch.';
      messages.push({ role: 'assistant', content: thanksMsg });
      addMessageBubble('assistant', thanksMsg);
      if (reason === 'limit') disableChatInput();
      saveSession();
    });

    contactEl.querySelector('.meddy-contact-name').addEventListener('input', function() { this.classList.remove('meddy-input-error'); });
    contactEl.querySelector('.meddy-contact-org').addEventListener('input', function() { this.classList.remove('meddy-input-error'); });
    contactEl.querySelector('.meddy-contact-email').addEventListener('input', function() {
      this.classList.remove('meddy-input-error');
      var err = contactEl.querySelector('.meddy-email-error');
      if (err) err.style.display = 'none';
    });
    contactEl.querySelector('.meddy-contact-email').addEventListener('blur', function() {
      var val = this.value.trim();
      if (val && !isValidEmail(val)) {
        this.classList.add('meddy-input-error');
        var err = contactEl.querySelector('.meddy-email-error');
        if (err) err.style.display = 'block';
      }
    });
    contactEl.querySelector('.meddy-contact-skip').addEventListener('click', function() {
      contactDismissed = true;
      contactEl.innerHTML = '';
      if (reason === 'limit') disableChatInput();
      saveSession();
    });
    scrollToBottom();
  }

  function disableChatInput() {
    var infoMsg = 'You can reach us at medcurity.com/contact or (509) 867-3645.';
    messages.push({ role: 'assistant', content: infoMsg, sender_type: 'system' });
    addMessageBubble('system', infoMsg);
    inputEl.disabled = true;
    inputEl.placeholder = 'Chat limit reached - contact us at medcurity.com/contact';
    panelEl.querySelector('.meddy-send').disabled = true;
    saveSession();
  }

  // ==================== SOFT CAPTURE ON CLOSE ====================

  function showCloseCapture() {
    // Remove any existing close capture card
    hideCloseCapture();
    var card = document.createElement('div');
    card.id = 'meddy-close-capture';
    card.innerHTML = '' +
      '<div class="meddy-contact-card">' +
        '<div class="meddy-contact-hdr">Before you go, want us to follow up on anything we discussed?</div>' +
        '<div class="meddy-contact-body">' +
          '<input type="text" class="meddy-close-name" placeholder="Full Name" required>' +
          '<input type="email" class="meddy-close-email" placeholder="Email" required>' +
          '<div class="meddy-email-error" id="meddy-close-email-error">Please enter a valid email address</div>' +
          '<input type="text" class="meddy-close-org" placeholder="Organization" required>' +
          '<input type="tel" class="meddy-close-phone" placeholder="Phone (optional)">' +
          '<div class="meddy-contact-btns"><button class="meddy-contact-send" id="meddy-close-send">Send</button><button class="meddy-contact-skip" id="meddy-close-skip">No thanks, just close</button></div>' +
        '</div>' +
      '</div>';
    // Insert before the input area
    var inputArea = panelEl.querySelector('.meddy-input-area');
    inputArea.parentNode.insertBefore(card, inputArea);
    scrollToBottom();

    card.querySelector('#meddy-close-send').addEventListener('click', function() {
      var name = card.querySelector('.meddy-close-name').value.trim();
      var email = card.querySelector('.meddy-close-email').value.trim();
      var org = card.querySelector('.meddy-close-org').value.trim();
      var phone = card.querySelector('.meddy-close-phone').value.trim();
      var emailInput = card.querySelector('.meddy-close-email');
      var errorEl = card.querySelector('#meddy-close-email-error');
      if (!name) { card.querySelector('.meddy-close-name').classList.add('meddy-input-error'); return; }
      if (!email) { emailInput.classList.add('meddy-input-error'); errorEl.style.display = 'block'; return; }
      if (!isValidEmail(email)) { emailInput.classList.add('meddy-input-error'); errorEl.style.display = 'block'; return; }
      if (!org) { card.querySelector('.meddy-close-org').classList.add('meddy-input-error'); return; }
      contactInfo = { name: name, email: email, organization: org, phone: phone };
      saveSession();
      fnPost('contact', { sessionId: sessionId, name: name, email: email, organization: org, phone: phone })
        .catch(function(err) { console.error('Meddy: Failed to save contact:', err); });
      // Show thanks briefly then close
      card.innerHTML = '<div class="meddy-contact-card"><div class="meddy-contact-hdr" style="text-align:center;padding:16px;">Thanks! We\'ll be in touch.</div></div>';
      setTimeout(function() { doClosePanel(); }, 1000);
    });

    card.querySelector('#meddy-close-skip').addEventListener('click', function() {
      closePromptDismissed = true;
      doClosePanel();
    });

    // Input validation listeners
    card.querySelector('.meddy-close-name').addEventListener('input', function() { this.classList.remove('meddy-input-error'); });
    card.querySelector('.meddy-close-org').addEventListener('input', function() { this.classList.remove('meddy-input-error'); });
    card.querySelector('.meddy-close-email').addEventListener('input', function() {
      this.classList.remove('meddy-input-error');
      card.querySelector('#meddy-close-email-error').style.display = 'none';
    });
    card.querySelector('.meddy-close-email').addEventListener('blur', function() {
      var val = this.value.trim();
      if (val && !isValidEmail(val)) {
        this.classList.add('meddy-input-error');
        card.querySelector('#meddy-close-email-error').style.display = 'block';
      }
    });
  }

  function hideCloseCapture() {
    var existing = shadowRoot.getElementById('meddy-close-capture');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function showRateLimitNotice() {
    // Show inline notice - don't add as assistant message
    var existing = panelEl.querySelector('.meddy-rate-notice');
    if (existing) return;
    var notice = document.createElement('div');
    notice.className = 'meddy-rate-notice';
    notice.textContent = 'Please wait a moment before sending another message.';
    var inputArea = panelEl.querySelector('.meddy-input-area');
    inputArea.parentNode.insertBefore(notice, inputArea);
    var sendBtn = panelEl.querySelector('.meddy-send');
    sendBtn.disabled = true;
    inputEl.disabled = true;
    setTimeout(function() {
      if (notice.parentNode) notice.parentNode.removeChild(notice);
      if (!chatLimitReached) {
        sendBtn.disabled = false;
        inputEl.disabled = false;
      }
    }, 30000);
  }

  function scrollToBottom() { setTimeout(function() { messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }); }, 50); }

  // ==================== TYPING INDICATORS ====================

  var aiTypingEl = null;
  function showAiTypingIndicator() {
    if (aiTypingEl) return;
    var wrap = document.createElement('div');
    wrap.className = 'meddy-typing-wrap';
    wrap.innerHTML = '<div class="meddy-typing-label">Meddy is typing...</div><div class="meddy-typing"><span></span><span></span><span></span></div>';
    aiTypingEl = wrap;
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }
  function hideAiTypingIndicator() {
    if (aiTypingEl && aiTypingEl.parentNode) aiTypingEl.parentNode.removeChild(aiTypingEl);
    aiTypingEl = null;
  }

  var employeeTypingTimeout = null;
  function showEmployeeTyping(name) {
    employeeTypingEl.textContent = (name || 'Medcurity Team') + ' is typing...';
    employeeTypingEl.style.display = 'block';
    clearTimeout(employeeTypingTimeout);
    employeeTypingTimeout = setTimeout(hideEmployeeTyping, 5000);
  }
  function hideEmployeeTyping() { employeeTypingEl.style.display = 'none'; }

  // ==================== TALK TO HUMAN ====================

  var humanConfirmEl = null;

  function showHumanConfirm() {
    if (humanRequested) return;
    if (humanConfirmEl) { hideHumanConfirm(); return; }
    var el = document.createElement('div');
    el.className = 'meddy-human-confirm';
    el.innerHTML = '<p>Talk to a Medcurity team member?</p><button class="meddy-human-confirm-yes">Yes, connect me</button><button class="meddy-human-confirm-cancel">Cancel</button>';
    el.addEventListener('click', function(e) { e.stopPropagation(); });
    el.querySelector('.meddy-human-confirm-yes').addEventListener('click', function() { hideHumanConfirm(); requestHuman(); });
    el.querySelector('.meddy-human-confirm-cancel').addEventListener('click', function() { hideHumanConfirm(); });
    el.className = 'meddy-human-confirm meddy-confirm-up';
    var anchor = panelEl.querySelector('.meddy-footer-row');
    anchor.appendChild(el);
    humanConfirmEl = el;
    // Close on outside click
    setTimeout(function() {
      document.addEventListener('click', humanConfirmOutsideClick);
    }, 10);
  }

  function hideHumanConfirm() {
    if (humanConfirmEl && humanConfirmEl.parentNode) humanConfirmEl.parentNode.removeChild(humanConfirmEl);
    humanConfirmEl = null;
    document.removeEventListener('click', humanConfirmOutsideClick);
  }

  function humanConfirmOutsideClick(e) {
    var path = e.composedPath ? e.composedPath() : [];
    if (humanConfirmEl && path.indexOf(humanConfirmEl) !== -1) return;
    hideHumanConfirm();
  }

  // (Three-dot menu removed 2026-06-12: end-chat is now a header button.)

  function showEndConfirm() {
    var overlay = document.createElement('div');
    overlay.className = 'meddy-end-confirm-overlay';
    overlay.innerHTML = '<div class="meddy-end-confirm-box"><p>End this conversation?</p><button class="meddy-end-confirm-yes">Yes, end</button><button class="meddy-end-confirm-cancel">Cancel</button></div>';
    overlay.querySelector('.meddy-end-confirm-yes').addEventListener('click', function() { removeEndConfirm(overlay); endConversation(); });
    overlay.querySelector('.meddy-end-confirm-cancel').addEventListener('click', function() { removeEndConfirm(overlay); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) removeEndConfirm(overlay); });
    panelEl.appendChild(overlay);
  }

  function removeEndConfirm(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function endConversation() {
    // Disable input immediately
    inputEl.disabled = true;
    inputEl.placeholder = 'Starting new conversation...';
    panelEl.querySelector('.meddy-send').disabled = true;

    // Signal backend to close this conversation FIRST (before any socket teardown)
    fnPost('end', { sessionId: sessionId })
      .catch(function(err) { console.error('Meddy: Failed to end conversation:', err); });

    // Show farewell message immediately
    var farewellMsg = "Thanks for chatting with us! If you need anything else, just start a new conversation.";
    messages.push({ role: 'assistant', content: farewellMsg, sender_type: 'system' });
    addMessageBubble('system', farewellMsg);

    // Wait 5s so visitor can read the message, then reset
    setTimeout(function() {
      // Set flag BEFORE disconnecting so handlers suppress connection messages
      intentionalDisconnect = true;

      // Clear sessionStorage
      try { sessionStorage.removeItem('meddy_session'); } catch (e) {}

      // Reset all state
      messages = [{ role: 'assistant', content: WELCOME_MESSAGE, sender_type: 'welcome' }];
      sessionId = generateId();
      contactInfo = null;
      contactShown = false;
      contactDismissed = false;
      closePromptDismissed = false;
      userMessageCount = 0;
      successfulResponseCount = 0;
      consecutiveErrors = 0;
      humanRequested = false;
      isTakenOver = false;
      isStreaming = false;
      chatLimitReached = false;
      messageQueue = [];
      connectionLost = false;
      disconnectMsgShown = false;
      syncHumanLinkVisibility();
      clearTimeout(humanRequestTimeout);
      humanRequestTimeout = null;

      // Reset UI
      hideResetButton();
      contactEl.innerHTML = '';
      renderMessages();
      renderSuggestions();
      inputEl.disabled = false;
      inputEl.placeholder = 'Ask about HIPAA compliance...';
      panelEl.querySelector('.meddy-send').disabled = false;

      // Reconnect socket with new session (intentionalDisconnect flag suppresses messages)
      subscribeChannel();

      saveSession();
      inputEl.focus();
    }, 5000);
  }

  function requestHuman() {
    if (humanRequested) return;
    humanRequested = true;
    if (suggestionsEl) suggestionsEl.innerHTML = '';
    syncHumanLinkVisibility();
    saveSession();

    // Request human and check availability in one call
    fnPost('request-human', { sessionId: sessionId, pageUrl: getPageContext() })
      .then(function(r) { return r.json(); })
      .then(function(data) { showHumanRequestResponse(data.available); })
      .catch(function() { showHumanRequestResponse(isBusinessHours()); });
  }

  function showHumanRequestResponse(agentAvailable) {
    if (agentAvailable) {
      var msg = "I've let our team know. Someone will be with you shortly.";
      messages.push({ role: 'assistant', content: msg, sender_type: 'system' });
      addMessageBubble('system', msg);
      // Show form after 60 seconds if no employee takes over
      humanRequestTimeout = setTimeout(function() {
        if (!isTakenOver && !contactInfo) {
          contactShown = false;
          var busyMsg = "Our team is tied up at the moment. Leave your info and someone will follow up as soon as possible.";
          messages.push({ role: 'assistant', content: busyMsg, sender_type: 'system' });
          addMessageBubble('system', busyMsg);
          saveSession();
          setTimeout(function() { showContactForm('human_timeout'); }, 300);
        }
      }, 60000);
    } else {
      // No agents available — skip the 60s wait, show form immediately
      var offMsg = "Our team isn't available right now. Leave your info and someone will follow up.";
      messages.push({ role: 'assistant', content: offMsg, sender_type: 'system' });
      addMessageBubble('system', offMsg);
      if (!contactInfo) {
        contactShown = false;
        setTimeout(function() { showContactForm('human_offhours'); }, 300);
      }
    }
    saveSession();
  }

  // ==================== CONVERSATION HELPERS ====================

  function onSuccessfulResponse() {
    successfulResponseCount++;
    consecutiveErrors = 0;
    hideResetButton();
    saveSession();
    // Lead capture: app side gets NO automatic form (those visitors are existing customers
    // already inside the app, not leads). Main site shows a slim capture bar after the 3rd response.
    if (!isAppSite && successfulResponseCount === 3) {
      setTimeout(function() { showSlimCaptureBar(); }, 500);
    }
    // Process any queued messages
    setTimeout(processQueue, 100);
  }

  function onResponseError() {
    consecutiveErrors++;
    saveSession();
    if (consecutiveErrors >= 2) showResetButton();
    setTimeout(processQueue, 100);
  }

  function showResetButton() {
    if (panelEl.querySelector('.meddy-reset-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'meddy-reset-wrap';
    wrap.innerHTML = '<button class="meddy-reset-btn">Start new conversation</button>';
    wrap.querySelector('.meddy-reset-btn').addEventListener('click', resetConversation);
    var inputArea = panelEl.querySelector('.meddy-input-area');
    inputArea.parentNode.insertBefore(wrap, inputArea);
  }

  function hideResetButton() {
    var el = panelEl.querySelector('.meddy-reset-wrap');
    if (el) el.parentNode.removeChild(el);
  }

  function resetConversation() {
    intentionalDisconnect = true;
    messages = [{ role: 'assistant', content: WELCOME_MESSAGE, sender_type: 'welcome' }];
    sessionId = generateId();
    contactInfo = null;
    contactShown = false;
    contactDismissed = false;
    closePromptDismissed = false;
    userMessageCount = 0;
    successfulResponseCount = 0;
    consecutiveErrors = 0;
    humanRequested = false;
    isTakenOver = false;
    isStreaming = false;
    chatLimitReached = false;
    messageQueue = [];
    connectionLost = false;
    disconnectMsgShown = false;
    syncHumanLinkVisibility();
    clearTimeout(humanRequestTimeout);
    humanRequestTimeout = null;
    hideResetButton();
    contactEl.innerHTML = '';
    renderMessages();
    renderSuggestions();
    inputEl.disabled = false;
    inputEl.placeholder = 'Ask about HIPAA compliance...';
    panelEl.querySelector('.meddy-send').disabled = false;
    saveSession();
    subscribeChannel();
    inputEl.focus();
  }

  // ==================== SEND MESSAGE ====================

  function processQueue() {
    if (messageQueue.length === 0 || isStreaming || chatLimitReached) return;
    var queued = messageQueue.shift();
    inputEl.value = queued;
    sendMessage();
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || chatLimitReached) return;

    // Character limit with visible feedback
    if (text.length > 500) {
      var charCountEl = panelEl.querySelector('#meddy-char-count');
      charCountEl.style.display = 'block';
      charCountEl.textContent = 'Message too long (' + text.length + '/500 characters)';
      charCountEl.className = 'meddy-char-count meddy-char-warn';
      return;
    }

    // Queue if currently streaming
    if (isStreaming) {
      messageQueue.push(text);
      inputEl.value = '';
      inputEl.style.height = 'auto';
      panelEl.querySelector('#meddy-char-count').style.display = 'none';
      // Show queued message immediately in chat
      messages.push({ role: 'user', content: text, sender_type: 'visitor' });
      userMessageCount++;
      closePromptDismissed = false;
      addMessageBubble('user', text);
      saveSession();
      return;
    }

    rtSend('visitor-stop-typing', {});
    clearTimeout(visitorTypingTimeout);
    suggestionsEl.innerHTML = '';

    var msgCid = genMsgCid();
    messages.push({ role: 'user', content: text, sender_type: 'visitor', cid: msgCid });
    userMessageCount++;
    closePromptDismissed = false;
    addMessageBubble('user', text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    panelEl.querySelector('#meddy-char-count').style.display = 'none';
    saveSession();

    // Lead capture is triggered by successfulResponseCount, not here
    // (see successful AI response handlers below)

    // If taken over by agent, just send to server (stores message) but don't expect AI response
    // Note: humanRequested alone does NOT suppress AI - AI continues until actual takeover
    if (isTakenOver) {
      isStreaming = true;
      var sendBtn = panelEl.querySelector('.meddy-send');
      sendBtn.disabled = true;

      function attemptTakeoverSend(retryCount) {
        fnPost('chat', { sessionId: sessionId, message: text, clientMsgId: msgCid, pageUrl: getPageContext(), pageContext: getPageContext() })
        .then(function(response) {
          if (!response.ok && retryCount < 1) { setTimeout(function() { attemptTakeoverSend(retryCount + 1); }, 1000); return; }
          // Read the full response as text (simple and reliable)
          return response.text();
        }).then(function() {
          isStreaming = false; sendBtn.disabled = false;
          setTimeout(processQueue, 100);
        }).catch(function(err) {
          console.error('Meddy: send error:', err);
          if (retryCount < 1) { setTimeout(function() { attemptTakeoverSend(retryCount + 1); }, 1000); return; }
          isStreaming = false; sendBtn.disabled = false;
          setTimeout(processQueue, 100);
        });
      }
      attemptTakeoverSend(0);
      return;
    }

    // Normal AI flow
    showAiTypingIndicator();
    isStreaming = true;
    var sendBtn2 = panelEl.querySelector('.meddy-send');
    sendBtn2.disabled = true;

    // PULSE PORT: the server keeps the transcript; we send just this
    // message with its dedup fingerprint. SSE is the response path.
    var finished = false;
    var fullText = '';
    var limitReached = false;
    var showLeadForm = false;

    function attemptFetch(retryCount) {
      fnPost('chat', { sessionId: sessionId, message: text, clientMsgId: msgCid, pageUrl: getPageContext(), pageContext: getPageContext() })
      .then(function(response) {
        if (!response.ok) {
          if (response.status === 429) {
            // IP rate limit - show inline notice, not an assistant message
            if (!finished) {
              finished = true;
              hideAiTypingIndicator();
              isStreaming = false;
              showRateLimitNotice();
            }
            return;
          }
          if (retryCount < 1) { setTimeout(function() { attemptFetch(retryCount + 1); }, 1000); return; }
          throw new Error("I'm having trouble responding right now. Please try again, or click 'Talk to a person' to reach our team.");
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function readChunk() {
          reader.read().then(function(result) {
            if (result.done || finished) { if (!finished) finishWithBuffer(); return; }
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (var i = 0; i < lines.length; i++) {
              if (finished) return;
              var line = lines[i];
              if (line.startsWith('data: ')) {
                var data = line.substring(6);
                if (data === '[DONE]') { if (!finished) finishWithBuffer(); return; }
                try {
                  var parsed = JSON.parse(data);
                  if (parsed.type === 'text') fullText += parsed.text;
                  else if (parsed.type === 'limit_reached') limitReached = true;
                  else if (parsed.type === 'show_lead_form') showLeadForm = true;
                  else if (parsed.type === 'state') {
                    // Server is telling us the conversation state — sync it
                    if (parsed.taken_over) { isTakenOver = true; syncHumanLinkVisibility(); saveSession(); }
                    if (parsed.human_requested) { humanRequested = true; syncHumanLinkVisibility(); saveSession(); }
                  }
                  else if (parsed.type === 'error') fullText = parsed.text;
                } catch (e) {}
              }
            }
            if (!finished) readChunk();
          }).catch(function(err) { console.error('Meddy: SSE read error:', err); if (!finished) finishWithBuffer(); });
        }
        readChunk();
      }).catch(function(err) {
        console.error('Meddy: fetch error:', err);
        if (retryCount < 1) { setTimeout(function() { attemptFetch(retryCount + 1); }, 1000); return; }
        if (!finished) {
          finished = true;
          hideAiTypingIndicator();
          var errMsg = err.message || "I'm having trouble responding right now. Please try again, or click 'Talk to a person' to reach our team.";
          messages.push({ role: 'assistant', content: errMsg });
          addMessageBubble('assistant', errMsg);
          isStreaming = false;
          sendBtn2.disabled = false;
          onResponseError();
        }
      });
    }
    attemptFetch(0);

    function finishWithBuffer() {
      if (finished) return;
      finished = true;
      hideAiTypingIndicator();
      if (limitReached) {
        chatLimitReached = true;
        isStreaming = false;
        var limitMsg = "It's been a great conversation! For anything else, our team would love to help you directly.";
        messages.push({ role: 'assistant', content: limitMsg });
        addMessageBubble('assistant', limitMsg);
        saveSession();
        setTimeout(function() { showContactForm('limit'); }, 300);
        return;
      }
      if (fullText) {
        fullText = removeTrailingFollowUp(fullText);
        messages.push({ role: 'assistant', content: fullText });
        addMessageBubble('assistant', fullText);
        onSuccessfulResponse();
      }
      if (showLeadForm && !contactInfo) {
        contactShown = false;
        setTimeout(function() { showContactForm('soft'); }, 300);
      }
      isStreaming = false;
      sendBtn2.disabled = false;
      saveSession();
    }
  }

  // Don't load widget on admin pages
  if (window.location.pathname.indexOf('/admin') === 0) return;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
