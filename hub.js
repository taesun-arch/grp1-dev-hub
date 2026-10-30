/* GRP1 개발 허브 공용 런타임. index.html · game.html 이 함께 쓴다.
 * 비밀번호 흐름 · 복호화 · 날짜 계산 · 공용 타임라인을 담고, 공용 컴포넌트 CSS 를 직접 주입한다
 * (site/ 에 둘 수 있는 파일이 정해져 있어 CSS 파일을 따로 두지 않는다). 전역은 window.HUB 하나뿐이다. */
(function () {
  'use strict';
  var HUB = {};
  var DAY = 864e5;
  var KEY_STORE = 'hub-pass';

  // ───────── 비밀번호 ─────────
  HUB.keyFromHash = function (hash) {
    var m = /(?:^#|[#&])k=([^&]+)/.exec(hash || '');
    return m ? decodeURIComponent(m[1]) : null;
  };
  HUB.savedKey = function () { try { return localStorage.getItem(KEY_STORE); } catch (e) { return null; } };
  HUB.saveKey = function (v) {
    try { if (v == null) localStorage.removeItem(KEY_STORE); else localStorage.setItem(KEY_STORE, v); } catch (e) { /* 저장 불가 환경 */ }
  };
  HUB.hashSuffix = function () { return location.hash || ''; };

  // ───────── 복호화 ─────────
  function b64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  HUB.decrypt = async function (enc, pass) {
    var km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, km,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
    var stream = new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  };
  HUB.loadScript = function (src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { s.remove(); ok(); }; s.onerror = function () { s.remove(); fail(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  };

  var hubEnc = null;
  HUB.openManifest = async function (pass) {
    if (!hubEnc) {
      await HUB.loadScript('hub.enc.js?t=' + Date.now());
      hubEnc = window.HUB_ENC; delete window.HUB_ENC;
      if (!hubEnc) throw new Error('매니페스트 없음');
    }
    return JSON.parse(await HUB.decrypt(hubEnc, pass));
  };

  // 문서 암호문은 같은 전역(window.HUB_DOC)으로 들어오므로 한 번에 하나씩 받는다.
  var docQueue = Promise.resolve();
  var docCache = {};
  HUB.openDoc = function (file, pass) {
    if (docCache[file]) return Promise.resolve(docCache[file]);
    var job = docQueue.then(async function () {
      await HUB.loadScript('data/' + file + '.enc.js');
      var enc = window.HUB_DOC; delete window.HUB_DOC;
      if (!enc) throw new Error('문서 없음');
      return HUB.decrypt(enc, pass);
    });
    docQueue = job.catch(function () {});
    return job.then(function (html) { docCache[file] = html; return html; });
  };

  // ───────── 시각 ─────────
  var KST = 9 * 3600e3;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function kst(ts) { return new Date(ts + KST); }   // getUTC* 로 한국 시간을 읽는다
  HUB.stamp = function (ts) { var d = kst(ts); return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
  HUB.ago = function (ts, now) {
    var s = Math.max(0, ((now == null ? Date.now() : now) - ts) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return Math.floor(s / 86400) + '일 전';
  };
  HUB.isFresh = function (ts, now) { return (now == null ? Date.now() : now) - ts < DAY; };
  HUB.todayKST = function (now) { var d = kst(now == null ? Date.now() : now); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  HUB.todayLabel = function (now) {
    var d = kst(now == null ? Date.now() : now);
    return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' (' + '일월화수목금토'.charAt(d.getUTCDay()) + ')';
  };

  // ───────── 날짜 계산(YYYY-MM-DD, 시간대 무관) ─────────
  function dn(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY; }
  function ds(n) { var d = new Date(n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function md(n) { var d = new Date(n * DAY); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
  function itemStart(it) { return dn(it.kind === 'phase' ? it.start : it.date); }
  function itemEnd(it) { return dn(it.kind === 'phase' ? it.end : it.date); }

  HUB.ganttRange = function (items, today) {
    var t = dn(today), lo = t - 7, hi = t + 7;
    if (items.length) {
      lo = Math.min.apply(null, items.map(itemStart)) - 7;
      hi = Math.max.apply(null, items.map(itemEnd)) + 7;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    return { start: ds(lo), end: ds(hi), days: hi - lo + 1 };
  };
  HUB.nextMilestone = function (items, today) {
    var t = dn(today), best = null;
    items.forEach(function (it) {
      if (it.kind !== 'milestone') return;
      var n = dn(it.date);
      if (n >= t && (!best || n < best.n)) best = { n: n, title: it.title, date: it.date };
    });
    return best && { title: best.title, date: best.date, days: best.n - t };
  };
  HUB.currentPhase = function (items, today) {
    var t = dn(today);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'phase' && t >= dn(it.start) && t <= dn(it.end)) return { title: it.title, day: t - dn(it.start) + 1, len: dn(it.end) - dn(it.start) + 1 };
    }
    return null;
  };
  HUB.ddayText = function (days) { return days === 0 ? 'D-day' : 'D-' + days; };
  HUB.md = function (date) { return md(dn(date)); };

  // ───────── 주소 ─────────
  HUB.docLink = function (slug, category, id, v) {
    return 'game.html?g=' + encodeURIComponent(slug) + '&c=' + encodeURIComponent(category) + '&d=' + encodeURIComponent(id) +
      (v ? '&v=' + v : '') + HUB.hashSuffix();
  };
  HUB.gameLink = function (slug, category) {
    return 'game.html?g=' + encodeURIComponent(slug) + (category ? '&c=' + encodeURIComponent(category) : '') + HUB.hashSuffix();
  };
  HUB.parseQuery = function (search) {
    var q = new URLSearchParams(search || '');
    var v = q.get('v');
    return { g: q.get('g'), c: q.get('c'), d: q.get('d'), v: v ? parseInt(v, 10) || null : null };
  };

  // ───────── 표시 도우미 ─────────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  HUB.escape = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  HUB.statusLabel = function (s) { return ({ kickoff: '킥오프', dev: '개발 중', launched: '런칭' })[s] || s; };
  // 슬러그 해시(FNV-1a)로 색상환 위치를 정한다. 비슷한 슬러그도 색이 멀리 떨어지게.
  HUB.fallbackColor = function (slug) {
    var h = 2166136261;
    for (var i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 'hsl(' + (h % 360) + ' 68% 64%)';
  };

  // 아이콘에서 대표색을 뽑는다(채도 높은 픽셀 가중 평균). 막대 위 글자가 늘 읽히도록 밝기를 58~70% 로 맞춘다.
  HUB.iconColor = function (dataUrl, slug) {
    var fallback = HUB.fallbackColor(slug);
    if (!dataUrl) return Promise.resolve(fallback);
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = c.height = 48;
          var x = c.getContext('2d'); x.drawImage(img, 0, 0, 48, 48);
          var px = x.getImageData(0, 0, 48, 48).data, r = 0, g = 0, b = 0, w = 0;
          for (var i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 200) continue;
            var mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
            var wt = (mx - mn) / 255 + 0.02; wt *= wt;
            r += px[i] * wt; g += px[i + 1] * wt; b += px[i + 2] * wt; w += wt;
          }
          if (!w) return ok(fallback);
          ok(hslOf(r / w, g / w, b / w));
        } catch (e) { ok(fallback); }
      };
      img.onerror = function () { ok(fallback); };
      img.src = dataUrl;
    });
  };
  function hslOf(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = Math.round(h * 60); if (h < 0) h += 360;
    }
    return 'hsl(' + h + ' ' + Math.round(Math.max(45, Math.min(90, s * 100))) + '% ' + Math.round(Math.max(58, Math.min(70, l * 100))) + '%)';
  }

  HUB.iconHtml = function (game, size, color) {
    var st = 'width:' + size + 'px;height:' + size + 'px';
    if (game.icon) return '<img class="hub-icon" src="' + game.icon + '" alt="" style="' + st + '">';
    return '<span class="hub-icon hub-icon-tile" style="' + st + ';background:' + color + ';font-size:' + Math.round(size * 0.44) + 'px">' +
      HUB.escape((game.name || '?').charAt(0)) + '</span>';
  };

  // ───────── 공용 타임라인 ─────────
  // rows = [{ label: html, color, items, href? }]. compact: 게임당 한 줄(첫 화면), 아니면 항목마다 한 줄(게임 화면).
  HUB.timeline = function (el, rows, today, opts) {
    opts = opts || {};
    var all = [];
    rows.forEach(function (r) { all = all.concat(r.items); });
    var rg = HUB.ganttRange(all, today), r0 = dn(rg.start), days = rg.days, t = dn(today);
    var pct = function (n) { return (n - r0) / days * 100; };
    var compact = !!opts.compact;
    var lab = opts.labelWidth || 180;

    var trackPx = Math.max(760, el.clientWidth || 760) - lab, pxDay = trackPx / days;
    var grid = '';
    var head = '';
    for (var n = r0; n < r0 + days; n++) {
      if (new Date(n * DAY).getUTCDay() !== 1) continue;
      grid += '<i class="tl-grid" style="left:' + pct(n) + '%"></i>';
      // "오늘" 꼬리표(약 80px)와 겹치는 눈금 라벨은 숨긴다
      if (Math.abs(n - t - 0.5) * pxDay > 62) head += '<span class="tl-tick" style="left:' + pct(n) + '%">' + md(n) + '</span>';
    }
    head += '<span class="tl-today-tag" style="left:' + pct(t + 0.5) + '%">오늘 ' + md(t) + '</span>';
    var now = '<i class="tl-now" style="left:' + pct(t + 0.5) + '%"></i>';

    // 마일스톤 이름이 서로 겹치면 두 번째 줄로 내린다(대략 폭: 글자 12px + 날짜 40px).
    function labelLines(items) {
      var ends = [-Infinity, -Infinity], out = {};
      items.filter(function (it) { return it.kind === 'milestone'; })
        .sort(function (a, b) { return dn(a.date) - dn(b.date); })
        .forEach(function (it) {
          var cx = pct(dn(it.date) + 0.5) / 100 * trackPx, w = it.title.length * 12 + 44;
          var line = cx - w / 2 > ends[0] + 8 ? 0 : 1;
          ends[line] = cx + w / 2; out[it.title + it.date] = line;
        });
      return out;
    }

    function shapes(items, color, mode, delay) {
      var lines = mode === 'compact' ? labelLines(items) : {};
      return items.map(function (it) {
        var c = '--c:' + color + ';--d:' + delay + 'ms;';
        if (it.kind === 'phase') {
          var a = dn(it.start), b = dn(it.end);
          var cls = 'tl-bar' + (b < t ? ' past' : '') + (it.done ? ' done' : '');
          var text = mode === 'row-label' ? (it.note ? '<span class="tl-note">' + HUB.escape(it.note) + '</span>' : '') : HUB.escape(it.title);
          return '<span class="' + cls + '" title="' + HUB.escape(it.title + ' ' + md(a) + '–' + md(b)) + '" style="' + c + 'left:' + pct(a) + '%;width:' + (pct(b + 1) - pct(a)) + '%">' + text + '</span>';
        }
        var m = dn(it.date), x = pct(m + 0.5);
        var dia = '<span class="tl-dia' + (m < t ? ' past' : '') + '" title="' + HUB.escape(it.title + ' ' + md(m)) + '" style="' + c + 'left:' + x + '%"></span>';
        var name = mode === 'row-label' ? '' : '<b>' + HUB.escape(it.title) + '</b>';
        var lc = mode === 'compact' ? ' l' + (lines[it.title + it.date] || 0) : '';
        return dia + '<span class="tl-ml' + lc + '" style="' + c + 'left:' + x + '%">' + name + '<small>' + md(m) + '</small></span>';
      }).join('');
    }

    var body = '';
    rows.forEach(function (r, i) {
      var tag = r.href ? 'a' : 'div', href = r.href ? ' href="' + r.href + '"' : '';
      if (compact) {
        body += '<' + tag + ' class="tl-row tl-compact"' + href + '><div class="tl-lab">' + r.label + '</div><div class="tl-track">' + grid + now +
          (r.items.length ? shapes(r.items, r.color, 'compact', i * 70) : '<span class="tl-empty">일정 미정</span>') + '</div></' + tag + '>';
      } else {
        r.items.forEach(function (it, j) {
          body += '<div class="tl-row"><div class="tl-lab tl-lab-item">' + HUB.escape(it.title) + '</div><div class="tl-track">' + grid + now +
            shapes([it], r.color, 'row-label', j * 60) + '</div></div>';
        });
      }
    });
    el.classList.add('tl');
    el.innerHTML = '<div class="tl-inner' + (opts.animate === false ? '' : ' tl-anim') + '" style="--lab:' + lab + 'px">' +
      '<div class="tl-row tl-headrow"><div class="tl-lab"></div><div class="tl-track">' + head + '</div></div>' + body + '</div>';
    // 좁은 화면: 오늘 선이 고정된 이름 열 오른쪽, 보이는 구간의 1/5 지점에 오도록 가로 스크롤한다.
    var inner = el.firstChild;
    if (el.scrollWidth > el.clientWidth) {
      var todayX = lab + (inner.clientWidth - lab) * pct(t + 0.5) / 100;
      el.scrollLeft = Math.max(0, todayX - lab - (el.clientWidth - lab) * 0.2);
    }
  };

  // ───────── 비밀번호 상자 ─────────
  // #gate 요소 안에 그린다. 링크(#k=) → 저장값 순으로 시도하고, 실패하면 입력을 받는다.
  HUB.gate = function (opts) {
    var root = document.getElementById('gate');
    root.innerHTML = '<div class="hub-gate"><h1>' + HUB.escape(opts.title || 'GRP1 개발 허브') + '</h1><p class="hub-gate-msg" id="gate-msg">여는 중…</p>' +
      '<form id="gate-form" hidden><input id="gate-pw" type="password" placeholder="비밀번호" autocomplete="current-password" aria-label="비밀번호"><button type="submit">열기</button></form></div>';
    var msg = document.getElementById('gate-msg'), form = document.getElementById('gate-form'), pw = document.getElementById('gate-pw');
    function say(text, bad) { msg.textContent = text; msg.className = 'hub-gate-msg' + (bad ? ' bad' : ''); }
    function ask(text, bad) { say(text, bad); form.hidden = false; pw.focus(); }

    if (!window.crypto || !crypto.subtle || typeof DecompressionStream === 'undefined') {
      return say('이 브라우저에서는 열 수 없습니다. 최신 Chrome, Edge, Safari 로 열어 주세요.', true);
    }
    async function attempt(pass, fromLink) {
      say('여는 중…');
      var manifest;
      try { manifest = await HUB.openManifest(pass); }
      catch (e) {
        if (/load|매니페스트/.test(e.message)) return say('목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.', true);
        if (!fromLink) HUB.saveKey(null);
        return ask(fromLink ? '링크의 비밀번호가 맞지 않습니다. 비밀번호를 직접 입력해 주세요.' : '비밀번호가 맞지 않습니다.', true);
      }
      HUB.saveKey(pass);
      root.hidden = true;
      opts.onOpen(manifest, pass);
    }
    form.addEventListener('submit', function (ev) { ev.preventDefault(); var v = pw.value.trim(); if (v) attempt(v, false); });
    var link = HUB.keyFromHash(location.hash), saved = HUB.savedKey();
    if (link) attempt(link, true);
    else if (saved) attempt(saved, false);
    else ask('팀에서 받은 비밀번호를 입력해 주세요.');
  };

  // ───────── 공용 CSS(토큰 · 아이콘 · 타임라인 · 비밀번호 상자) ─────────
  HUB.CSS = [
    ':root{color-scheme:dark;--stage:#101119;--surface:#1b1d29;--surface-2:#232636;--line:#2c3042;--line-soft:rgba(44,48,66,.6);',
    '--ink:#f4f5fa;--ink-2:#b4b8c8;--ink-3:#80849a;--accent:#8aa2ff;--bad:#ff9a70;--on-color:#14151d;',
    '--kr:"IBM Plex Sans KR",-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif;',
    '--game:"Fredoka","IBM Plex Sans KR",-apple-system,"Segoe UI",sans-serif;--gutter:clamp(16px,4vw,48px);--ease:cubic-bezier(.2,.7,.2,1)}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;background:var(--stage);color:var(--ink);font:14px/1.55 var(--kr);-webkit-font-smoothing:antialiased}',
    'a{color:inherit;text-decoration:none}',
    ':focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}',
    '.hub-icon{flex:none;display:block;border-radius:23%;object-fit:cover}',
    '.hub-icon-tile{display:grid;place-items:center;font-family:var(--game);font-weight:700;color:var(--on-color)}',

    '.tl{position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin}',
    '.tl-inner{position:relative;min-width:760px}',
    '.tl-row.tl-headrow{height:28px;border-bottom:1px solid var(--line)}',
    '.tl-tick{position:absolute;top:5px;transform:translateX(-50%);font-size:11.5px;color:var(--ink-3);white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.tl-today-tag{position:absolute;top:3px;transform:translateX(-50%);z-index:4;padding:1px 8px;border-radius:999px;background:var(--accent);color:var(--on-color);font-size:11.5px;font-weight:600;white-space:nowrap}',
    '.tl-row{position:relative;display:flex;height:40px;border-bottom:1px solid var(--line-soft)}',
    '.tl-row:last-child{border-bottom:0}',
    '.tl-row.tl-compact{height:66px}',
    'a.tl-row{transition:background .15s}',
    'a.tl-row:hover{background:rgba(255,255,255,.028)}',
    '.tl-lab{flex:none;width:var(--lab);padding-right:14px;display:flex;align-items:center;gap:10px;min-width:0;font-size:13.5px;font-weight:500;',
    'position:sticky;left:0;z-index:5;background:var(--surface)}',
    '.tl-lab>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tl-lab-item{padding-left:4px;color:var(--ink-2);font-weight:400;font-size:13px}',
    '.tl-track{position:relative;flex:1}',
    '.tl-grid{position:absolute;top:0;bottom:0;width:1px;background:var(--line-soft)}',
    '.tl-now{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--accent);box-shadow:0 0 14px 1px rgba(138,162,255,.5);z-index:3}',
    '.tl-bar{position:absolute;top:50%;height:20px;margin-top:-10px;padding:0 8px;border-radius:6px;background:var(--c);color:var(--on-color);',
    'font-size:11.5px;font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform-origin:left center}',
    '.tl-compact .tl-bar,.tl-compact .tl-dia{top:20px}',
    '.tl-bar.past{opacity:.4}',
    '.tl-bar.done::after{content:" ✓"}',
    '.tl-note{font-weight:500}',
    '.tl-dia{position:absolute;top:50%;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:2px;transform:rotate(45deg);background:var(--c);box-shadow:0 0 0 3px var(--surface);z-index:2}',
    '.tl-dia.past{opacity:.45}',
    '.tl-ml{position:absolute;top:50%;margin-top:-9px;padding-left:13px;line-height:18px;font-size:12px;white-space:nowrap;z-index:2;color:var(--ink)}',
    '.tl-ml b{font-weight:500}',
    '.tl-ml small{margin-left:5px;font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums}',
    '.tl-compact .tl-ml{margin:0;padding:0;transform:translateX(-50%);top:32px}',
    '.tl-compact .tl-ml.l1{top:47px}',
    '.tl-empty{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:12.5px;color:var(--ink-3)}',
    '.tl-anim .tl-bar{animation:tl-grow .75s var(--ease) both;animation-delay:var(--d)}',
    '.tl-anim .tl-dia,.tl-anim .tl-ml{animation:tl-fade .4s ease both;animation-delay:calc(var(--d) + .4s)}',
    '@keyframes tl-grow{from{transform:scaleX(0)}}',
    '@keyframes tl-fade{from{opacity:0}}',

    '.hub-gate{max-width:380px;margin:18vh auto 0;padding:26px 24px 22px;background:var(--surface);border:1px solid var(--line);border-radius:14px}',
    '.hub-gate h1{margin:0 0 6px;font-size:17px;font-weight:600}',
    '.hub-gate-msg{margin:0;color:var(--ink-2);font-size:13.5px}',
    '.hub-gate-msg.bad{color:var(--bad)}',
    '.hub-gate form{display:flex;gap:8px;margin-top:16px}',
    '.hub-gate form[hidden]{display:none}',
    '.hub-gate input{flex:1;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--stage);color:inherit;font:inherit}',
    '.hub-gate button{padding:9px 16px;border:0;border-radius:8px;background:var(--accent);color:var(--on-color);font:inherit;font-weight:600;cursor:pointer}',
    '@media (max-width:420px){.hub-gate{margin:12vh 16px 0}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}'
  ].join('\n');
  if (document.head) {
    var st = document.createElement('style');
    st.textContent = HUB.CSS;
    document.head.insertBefore(st, document.head.firstChild);
  }

  window.HUB = HUB;
})();
