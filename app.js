import { LEVELS, gateOpen, firstDifference, parseIRC, parseFix, createRound, addFork } from './core.mjs';

const $ = id => document.getElementById(id);
const words = { F: 'Forward', L: 'Turn left', R: 'Turn right', W: 'Wait' };
const hints = [{ slot: 1, op: 'W' }, { slot: 4, op: 'L' }, { slot: 3, op: 'L' }];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let round, focusedId = 0, editParentId = 0, selectedSlot = 1, chosenOp = 'W';
let pair, duration = 0, playTime = 0, playing = false, previousFrame = 0, endHold = 0;
let socket = null, channelName = '', chatCount = 0, liveForks = 0, playQueue = [];
let localSerial = 0;
const query = new URLSearchParams(location.search);
const initialLevel = Number(query.get('level') || 0);
if (query.get('overlay') === '1') document.body.classList.add('overlay');

function notice(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function connection(text, state = '') {
  $('connection').textContent = text;
  $('connection').className = 'connection ' + state;
}
function resultText(run) {
  if (run.status === 'delivered') return 'Delivered at beat ' + run.finishTick;
  if (run.status === 'crashed') return (run.states.at(-1).reason.startsWith('Gate') ? 'Gate shut' : 'Off track') + ' at beat ' + run.finishTick;
  return 'Route ends at beat ' + run.finishTick;
}
function outcome(run) {
  return run.status === 'delivered' ? 'Delivered' : run.status === 'crashed' ? 'Stopped' : 'Unfinished';
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function point(state, shift = 0) {
  return { x: 150 + state.x * 80, y: 44 + state.y * 64 + shift };
}
function robotMarkup(id, color, label) {
  return '<g id="' + id + '" class="robot">' +
    '<g class="robot-shell"><rect class="robot-body" x="-16" y="-14" width="32" height="28" rx="9" fill="' + color + '"/>' +
    '<rect x="-11" y="-18" width="8" height="5" rx="2" fill="' + color + '"/><rect x="4" y="-18" width="8" height="5" rx="2" fill="' + color + '"/>' +
    '<rect x="-11" y="13" width="8" height="5" rx="2" fill="' + color + '"/><rect x="4" y="13" width="8" height="5" rx="2" fill="' + color + '"/>' +
    '<rect x="-7" y="-6" width="12" height="12" rx="3" fill="#fbfcff"/><path d="M8 -5L15 0L8 5Z" fill="#fbfcff"/></g>' +
    '<g class="crash-mark" stroke="' + color + '" stroke-width="3"><path d="M20 -17L26 -23M23 -6L31 -6M20 7L26 13"/></g>' +
    '<text class="robot-label" x="0" y="-27" fill="' + color + '">' + label + '</text></g>';
}
function drawWorld() {
  const level = round.level;
  const floor = new Set(level.floor.map(p => p.join(',')));
  const track = level.floor.map(([x, y]) => point({ x, y }));
  const minX = Math.min(...track.map(p => p.x));
  const maxX = Math.max(...track.map(p => p.x));
  const minY = Math.min(...track.map(p => p.y));
  const maxY = Math.max(...track.map(p => p.y));
  const view = { x: minX - 52, y: minY - 64, width: maxX - minX + 104, height: maxY - minY + 128 };
  let svg = '<defs><pattern id="paper-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#ebe5f3"/></pattern></defs>';
  svg += '<rect x="' + (view.x + 6) + '" y="' + (view.y + 6) + '" width="' + (view.width - 12) + '" height="' + (view.height - 12) + '" rx="8" fill="url(#paper-grid)"/>';
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const p = point({ x, y });
      if (!floor.has(x + ',' + y)) continue;
      const start = x === level.start.x && y === level.start.y;
      const goal = x === level.goal.x && y === level.goal.y;
      svg += '<rect class="floor-tile' + (start ? ' start-tile' : goal ? ' goal-tile' : '') + '" x="' + (p.x - 36) + '" y="' + (p.y - 28) + '" width="72" height="56" rx="8"/>';
      svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="2" fill="#d5cde4"/>';
    }
  }
  const path = (run, shift) => run.states.map(s => {
    const p = point(s, shift);
    return p.x + ',' + p.y;
  }).join(' ');
  svg += '<polyline class="route parent" points="' + path(pair.parent.run, -7) + '"/>';
  if (pair.child) svg += '<polyline class="route child" points="' + path(pair.child.run, 7) + '"/>';
  const start = point(level.start);
  const goal = point(level.goal);
  svg += '<text class="start-label" x="' + start.x + '" y="' + (start.y + 46) + '" text-anchor="middle">Start</text>';
  svg += '<g transform="translate(' + goal.x + ' ' + goal.y + ')"><rect x="-17" y="-17" width="34" height="34" rx="7" fill="#f5cc79" stroke="#deb66d"/><path d="M-6 -17V-4H6V-17" fill="#ffedc4"/><path d="M-11 7H-3" stroke="#bf964e" stroke-width="2"/></g>';
  svg += '<text class="goal-label" x="' + goal.x + '" y="' + (goal.y + 46) + '" text-anchor="middle">Deliver</text>';
  level.gates.forEach((gate, i) => {
    const p = point(gate);
    svg += '<g id="gate-' + i + '" transform="translate(' + p.x + ' ' + p.y + ')"><rect class="gate-frame" x="-18" y="-31" width="36" height="62" rx="7"/>' +
      '<rect class="gate-bar" x="-11" y="-24" width="5" height="48" rx="2"/><rect class="gate-bar" x="-2" y="-24" width="5" height="48" rx="2"/><rect class="gate-bar" x="7" y="-24" width="5" height="48" rx="2"/>' +
      '<text class="gate-label" x="0" y="-42" text-anchor="middle">Clock gate</text></g>';
  });
  if (pair.diff !== null && pair.child) {
    const left = pair.parent.run.states[Math.min(pair.diff, pair.parent.run.states.length - 1)];
    const right = pair.child.run.states[Math.min(pair.diff, pair.child.run.states.length - 1)];
    const p = point({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    svg += '<ellipse id="divergence-ring" class="divergence-ring" cx="' + p.x + '" cy="' + p.y + '" rx="37" ry="26" opacity="0"/>';
  }
  svg += robotMarkup('robot-parent', '#344cdb', pair.child ? 'Original' : 'Robot');
  if (pair.child) svg += robotMarkup('robot-child', '#e47768', 'Remix');
  $('arena').setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
  $('arena').innerHTML = svg;
  $('arena').setAttribute('aria-label', level.title + '. ' + resultText(pair.parent.run) + (pair.child ? '. Remix ' + resultText(pair.child.run).toLowerCase() : ''));
  $('level-title').textContent = level.title;
  $('level-brief').textContent = level.brief;
}
function programStrip(container, record, changedSlot) {
  container.replaceChildren();
  if (!record) {
    container.append(element('span', 'program-placeholder', 'Make a remix to see its future.'));
    return;
  }
  record.program.forEach((op, index) => {
    const tile = element('span', 'instruction' + (index + 1 === changedSlot ? ' changed' : ''));
    tile.append(element('small', '', String(index + 1)), document.createTextNode(op));
    tile.title = 'Step ' + (index + 1) + ': ' + words[op];
    tile.dataset.tick = index + 1;
    container.append(tile);
  });
}
function trail(id) {
  const records = [];
  for (let record = round.records.get(id); record; record = round.records.get(record.parentId)) records.unshift(record);
  return records;
}
function renderTrail() {
  $('lineage').replaceChildren();
  trail(focusedId).forEach((record, i) => {
    if (i) $('lineage').append(element('span', 'fork-dot', '↳'));
    const button = element('button', '', '#' + record.id + (record.id ? ' ' + record.author.name : ' Original'));
    button.addEventListener('click', () => showRecord(record.id));
    $('lineage').append(button);
  });
}
function renderVersions() {
  const records = [...round.records.values()].reverse();
  $('versions').replaceChildren();
  records.slice(0, 24).forEach(record => {
    const button = element('button', 'version' + (record.id === focusedId ? ' active' : ''));
    button.append(element('span', 'version-id', '#' + record.id), element('span', 'version-author', record.author.name));
    button.append(element('span', 'version-outcome' + (record.run.status === 'delivered' ? ' success' : ''), outcome(record.run)));
    button.addEventListener('click', () => showRecord(record.id));
    $('versions').append(button);
  });
  const saved = editParentId;
  $('parent-select').replaceChildren();
  [...round.records.values()].forEach(record => {
    const option = element('option', '', '#' + record.id + ' ' + record.author.name + ' — ' + outcome(record.run));
    option.value = record.id;
    $('parent-select').append(option);
  });
  $('parent-select').value = saved;
}
function renderEditor() {
  const record = round.records.get(editParentId);
  selectedSlot = Math.min(Math.max(1, selectedSlot), record.program.length);
  $('parent-select').value = editParentId;
  $('editable-program').replaceChildren();
  record.program.forEach((op, i) => {
    const button = element('button', i + 1 === selectedSlot ? 'selected' : '');
    button.append(element('small', '', String(i + 1)), document.createTextNode(op));
    button.title = 'Replace step ' + (i + 1) + ': ' + words[op];
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(i + 1 === selectedSlot));
    button.addEventListener('click', () => {
      selectedSlot = i + 1;
      if (chosenOp === op) chosenOp = op === 'W' ? 'F' : 'W';
      renderEditor();
    });
    $('editable-program').append(button);
  });
  $('selected-slot').textContent = selectedSlot;
  $('selected-instruction').textContent = words[record.program[selectedSlot - 1]];
  document.querySelectorAll('[data-op]').forEach(button => {
    button.disabled = button.dataset.op === record.program[selectedSlot - 1];
  });
  $('chat-command').textContent = '!fix ' + editParentId + ' ' + selectedSlot + ' ' + chosenOp;
}
function showRecord(id, replay = true, edit = true) {
  const record = round.records.get(id);
  if (!record) return;
  focusedId = id;
  if (edit) editParentId = id;
  pair = record.parentId === null ? { parent: record, child: null, diff: null }
    : { parent: round.records.get(record.parentId), child: record, diff: firstDifference(round.records.get(record.parentId).run, record.run) };
  duration = Math.max(pair.parent.run.finishTick, pair.child?.run.finishTick || 0) + .65;
  $('scrub').max = duration;
  $('parent-caption').textContent = (pair.parent.id ? 'Parent #' + pair.parent.id + ' by ' + pair.parent.author.name : 'Original #0');
  $('parent-result').textContent = resultText(pair.parent.run);
  $('parent-result').className = pair.parent.run.status === 'delivered' ? 'success' : '';
  $('child-caption').textContent = pair.child ? 'Remix #' + pair.child.id + ' by ' + pair.child.author.name : 'Your remix';
  $('child-result').textContent = pair.child ? resultText(pair.child.run) : '';
  $('child-result').className = pair.child?.run.status === 'delivered' ? 'success' : '';
  programStrip($('parent-program'), pair.parent);
  programStrip($('child-program'), pair.child, pair.child?.slot);
  $('divergence').textContent = pair.child ? pair.diff === null ? 'This change leaves the route the same.' : 'First change at beat ' + pair.diff : 'Pick one change.';
  $('divergence').className = pair.diff !== null ? 'changed' : '';
  renderVersions();
  renderEditor();
  renderTrail();
  drawWorld();
  playTime = replay && !reducedMotion ? 0 : duration;
  playing = replay && !reducedMotion;
  endHold = 0;
  renderFrame();
}
function frameAt(run, time) {
  const tick = Math.floor(time);
  const left = run.states[Math.min(tick, run.states.length - 1)];
  const right = run.states[Math.min(tick + 1, run.states.length - 1)];
  const fraction = Math.min(time - tick, 1);
  const turn = ((right.dir - left.dir + 6) % 4) - 2;
  return { x: left.x + (right.x - left.x) * fraction, y: left.y + (right.y - left.y) * fraction, dir: left.dir + turn * fraction, status: left.status };
}
function renderFrame() {
  if (!pair) return;
  const tick = Math.min(Math.floor(playTime), Math.ceil(duration));
  const place = (id, run, shift) => {
    const state = frameAt(run, playTime);
    const p = point(state, shift);
    const robot = $(id);
    if (!robot) return;
    robot.setAttribute('transform', 'translate(' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ')');
    robot.querySelector('.robot-shell').setAttribute('transform', 'rotate(' + (state.dir * 90).toFixed(2) + ')');
    robot.classList.toggle('crashed', state.status === 'crashed');
  };
  place('robot-parent', pair.parent.run, pair.child ? -9 : 0);
  if (pair.child) place('robot-child', pair.child.run, 9);
  round.level.gates.forEach((gate, i) => $('gate-' + i).classList.toggle('gate-open', gateOpen(gate, tick)));
  const ring = $('divergence-ring');
  if (ring) ring.setAttribute('opacity', tick >= pair.diff ? '.55' : '0');
  $('beat').textContent = tick;
  $('gate-hint').textContent = round.level.gates.length ? 'Gate ' + (gateOpen(round.level.gates[0], tick) ? 'open' : 'closed') : '';
  $('split-hint').textContent = pair.child ? pair.diff === null ? 'Same route' : 'First split: beat ' + pair.diff : '';
  $('scrub').value = playTime;
  $('play-pause').textContent = playing ? 'Pause' : 'Play';
  document.querySelectorAll('.program-strip .instruction').forEach(tile => {
    const row = tile.closest('.original-row') ? pair.parent : pair.child;
    tile.classList.toggle('current', Number(tile.dataset.tick) === tick && row && tick <= row.run.finishTick);
  });
}
function loop(now) {
  const elapsed = previousFrame ? Math.min((now - previousFrame) / 1000, .12) : 0;
  previousFrame = now;
  if (playing) {
    playTime = Math.min(duration, playTime + elapsed / .68);
    if (playTime >= duration) playing = false;
    renderFrame();
  } else if (playQueue.length && $('auto-show').checked) {
    endHold += elapsed;
    if (endHold > 1) showRecord(playQueue.shift(), true, false);
  }
  requestAnimationFrame(loop);
}
function setLevel(id, example = true) {
  const level = LEVELS[id] || LEVELS[0];
  round = createRound(level);
  playQueue = [];
  liveForks = 0;
  focusedId = 0;
  editParentId = 0;
  selectedSlot = hints[level.id].slot;
  chosenOp = hints[level.id].op;
  if (example) {
    const first = addFork(round, { parentId: 0, ...hints[level.id], author: { id: 'sample-rae', name: 'Rae (example)' }, messageId: 'sample-1', source: 'example' });
    focusedId = first.record.id;
    if (level.id === 2) {
      const second = addFork(round, { parentId: first.record.id, slot: 9, op: 'F', author: { id: 'sample-sol', name: 'Sol (example)' }, messageId: 'sample-2', source: 'example' });
      focusedId = second.record.id;
      editParentId = first.record.id;
      selectedSlot = 9;
      chosenOp = 'F';
    }
  }
  $('level-tabs').replaceChildren();
  LEVELS.forEach(item => {
    const button = element('button', item.id === level.id ? 'active' : '');
    button.append(element('strong', '', String(item.id + 1)), document.createTextNode(item.title));
    button.setAttribute('aria-pressed', String(item.id === level.id));
    button.addEventListener('click', () => {
      if (socket) { notice('Disconnect chat before changing the challenge. The version IDs belong to this round.', true); return; }
      connection('Local example');
      setLevel(item.id);
    });
    $('level-tabs').append(button);
  });
  showRecord(focusedId, true, false);
}
function makeLocalFork(op) {
  chosenOp = op;
  const result = addFork(round, { parentId: editParentId, slot: selectedSlot, op, author: { id: 'local-you', name: 'You (local preview)' }, messageId: 'local-' + (++localSerial), source: 'local' });
  if (!result.ok) { notice(result.error, true); return; }
  const parent = result.record.parentId;
  notice('Local remix #' + result.record.id + ' replaces #' + parent + ', step ' + selectedSlot + '. Send the same change in Twitch chat to join the live round.');
  showRecord(result.record.id, true, false);
}
function receiveLine(line, ws) {
  const event = parseIRC(line);
  if (!event) return;
  if (event.command === 'PING') { ws.send('PONG :' + (event.trailing || event.params[0] || 'tmi.twitch.tv') + '\r\n'); return; }
  if (event.command === 'ROOMSTATE' && event.params[0]?.toLowerCase() === '#' + channelName) {
    connection('Live #' + channelName, 'live');
    return;
  }
  if (event.command === 'NOTICE') { notice(event.trailing || 'Chat connection needs another try.', true); return; }
  if (event.command !== 'PRIVMSG' || event.params[0]?.toLowerCase() !== '#' + channelName) return;
  chatCount++;
  $('received').textContent = chatCount + ' messages read · ' + liveForks + ' new remixes';
  if (!/^!fix(?:\s|$)/i.test(event.trailing)) return;
  const fix = parseFix(event.trailing);
  if (!fix) { notice('Use !fix <version> <step> <F|L|R|W>, for example ' + $('chat-command').textContent + '.', true); return; }
  if (!event.tags.id || !event.tags['user-id']) { notice('This command is missing Twitch identity tags. Listen again.', true); return; }
  const result = addFork(round, { ...fix, author: { id: event.tags['user-id'], name: (event.tags['display-name'] || 'Viewer').slice(0, 40) }, messageId: event.tags.id, source: 'twitch' });
  if (!result.ok) { notice(result.error, true); return; }
  if (result.duplicate) return;
  liveForks++;
  $('received').textContent = chatCount + ' messages read · ' + liveForks + ' new remixes';
  notice(result.record.author.name + ' made remix #' + result.record.id + '. ' + resultText(result.record.run) + '.');
  renderVersions();
  if ($('auto-show').checked) {
    playQueue.push(result.record.id);
    // Six queued showpieces; every accepted record remains selectable.
    if (playQueue.length > 6) playQueue.shift();
  }
}
function disconnectChat(show = true) {
  const old = socket;
  socket = null;
  if (old) old.close();
  $('disconnect').hidden = true;
  $('listen').textContent = 'Listen';
  if (show) { connection('Chat disconnected'); notice('Versions stay on this page. Listen again to resume chat.'); }
}
function connectChat(channel, keepRound = false) {
  if (!/^[a-z0-9_]{1,25}$/i.test(channel)) { notice('Enter a Twitch channel name, such as twitchdev.', true); return; }
  disconnectChat(false);
  channelName = channel.toLowerCase();
  $('channel').value = channelName;
  chatCount = 0;
  liveForks = 0;
  $('received').textContent = '';
  if (!keepRound) setLevel(round.level.id, false);
  connection('Joining #' + channelName);
  notice('Listening for ' + $('chat-command').textContent + '. This page reads chat and sends no chat messages.');
  $('disconnect').hidden = false;
  $('listen').textContent = 'Reconnect';
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  socket = ws;
  ws.onopen = () => {
    if (ws !== socket) return;
    const nick = 'justinfan' + String(Math.floor(10000 + Math.random() * 89999));
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
    ws.send('PASS SCHMOOPIIE\r\n');
    ws.send('NICK ' + nick + '\r\n');
    ws.send('JOIN #' + channelName + '\r\n');
  };
  ws.onmessage = event => {
    if (ws !== socket) return;
    for (const line of String(event.data).split('\r\n')) if (line) receiveLine(line, ws);
  };
  ws.onerror = () => {
    if (ws !== socket) return;
    connection('Chat connection failed', 'failed');
    notice('Read-only chat connection failed. Press Reconnect to try again.', true);
  };
  ws.onclose = () => {
    if (ws !== socket) return;
    socket = null;
    connection('Chat disconnected', 'failed');
    notice('Chat disconnected. Versions stay on this page; press Reconnect to resume.', true);
  };
}
function savedRound() {
  return { format: 'forkline', version: 1, levelId: round.level.id, activeId: focusedId,
    records: [...round.records.values()].filter(record => record.id).map(record => ({
      id: record.id, parentId: record.parentId, slot: record.slot, op: record.op, name: record.author.name,
    })) };
}
function loadRound(saved) {
  if (saved?.format !== 'forkline' || saved.version !== 1 || !Number.isInteger(saved.levelId) || !LEVELS[saved.levelId] || !Array.isArray(saved.records) || saved.records.length > 127) throw Error('Use a Forkline replay from this version.');
  const restored = createRound(LEVELS[saved.levelId]);
  for (const item of saved.records) {
    if (!Number.isInteger(item.id) || item.id !== restored.nextId || typeof item.name !== 'string' || item.name.length > 40) throw Error('This replay has an invalid version or credit.');
    const result = addFork(restored, { parentId: item.parentId, slot: item.slot, op: item.op, author: { id: 'replay-' + item.id, name: item.name }, messageId: 'replay-' + item.id, source: 'replay' });
    if (!result.ok) throw Error(result.error);
  }
  if (!Number.isInteger(saved.activeId) || !restored.records.has(saved.activeId)) throw Error('Choose a version present in this replay.');
  disconnectChat(false);
  setLevel(saved.levelId, false);
  round = restored;
  editParentId = saved.activeId;
  selectedSlot = 1;
  chosenOp = round.records.get(editParentId).program[0] === 'W' ? 'F' : 'W';
  connection('Saved replay');
  $('received').textContent = '';
  showRecord(saved.activeId);
  notice('Saved replay loaded. Credits are saved names; new Twitch commands get fresh identity tags.');
}
function encodeSaved() {
  const bytes = new TextEncoder().encode(JSON.stringify(savedRound()));
  return btoa(String.fromCharCode(...bytes));
}
async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); notice(message); }
  catch { notice('Copy this text: ' + text); }
}
function replayUrl(overlay = false) {
  const url = new URL(location.href);
  url.search = '';
  if (overlay) {
    url.searchParams.set('overlay', '1');
    url.searchParams.set('level', round.level.id);
    if (channelName && socket) url.searchParams.set('channel', channelName);
  }
  url.hash = 'replay=' + encodeURIComponent(encodeSaved());
  return url.href;
}
$('parent-select').addEventListener('change', () => {
  editParentId = Number($('parent-select').value);
  const current = round.records.get(editParentId).program[selectedSlot - 1];
  if (chosenOp === current) chosenOp = current === 'W' ? 'F' : 'W';
  renderEditor();
});
document.querySelectorAll('[data-op]').forEach(button => button.addEventListener('click', () => makeLocalFork(button.dataset.op)));
$('replay').addEventListener('click', () => { playTime = 0; playing = true; renderFrame(); });
$('play-pause').addEventListener('click', () => { if (playTime >= duration) playTime = 0; playing = !playing; renderFrame(); });
$('scrub').addEventListener('input', () => { playing = false; playTime = Number($('scrub').value); renderFrame(); });
$('channel-form').addEventListener('submit', event => { event.preventDefault(); connectChat($('channel').value.trim()); });
$('disconnect').addEventListener('click', () => disconnectChat());
$('reset').addEventListener('click', () => { disconnectChat(false); $('received').textContent = ''; connection('Local example'); setLevel(round.level.id); notice('Example credits are fictional. Make your own one-instruction change.'); });
$('copy-command').addEventListener('click', () => copyText($('chat-command').textContent, 'Command copied. Paste it in your Twitch channel chat.'));
$('share').addEventListener('click', () => copyText(replayUrl(), 'Replay link copied. It contains the programs and display credits, with no Twitch IDs or raw chat.'));
$('overlay').addEventListener('click', () => copyText(replayUrl(true), 'OBS URL copied with this round snapshot. Add a Browser Source; use this challenge’s command IDs.'));
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(savedRound(), null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = 'forkline-remix.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  notice('Saved programs and display credits. Twitch user IDs, message IDs and ordinary chat stay out of the file.');
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0];
  if (!file) return;
  try {
    if (file.size > 50000) throw Error('Use a Forkline save under 50 KB.');
    loadRound(JSON.parse(await file.text()));
  } catch (error) { notice('Replay failed: ' + error.message, true); }
  $('import-file').value = '';
});
function loadHash() {
  const encodedReplay = new URLSearchParams(location.hash.slice(1)).get('replay');
  if (!encodedReplay) return false;
  try {
    if (encodedReplay.length > 50000) throw Error('Use a replay under 50 KB.');
    const bytes = Uint8Array.from(atob(encodedReplay), char => char.charCodeAt(0));
    loadRound(JSON.parse(new TextDecoder().decode(bytes)));
    return true;
  } catch (error) { notice('Replay failed: ' + error.message, true); return false; }
}
setLevel(Number.isInteger(initialLevel) && LEVELS[initialLevel] ? initialLevel : 0, !query.get('channel'));
const restored = loadHash();
if (query.get('channel')) connectChat(query.get('channel'), restored);
// Pasting a replay URL into the same tab is a hash-only navigation.
window.addEventListener('hashchange', () => {
  const loaded = loadHash();
  const channel = new URLSearchParams(location.search).get('channel');
  if (loaded && channel) connectChat(channel, true);
});
requestAnimationFrame(loop);
