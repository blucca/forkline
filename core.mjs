const OPS = new Set(['F', 'L', 'R', 'W']);
const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const LEVELS = freeze([
  {
    id: 0, title: 'One beat late',
    brief: 'The gate opens on beats 0 and 1 of each four-beat cycle. Buy one beat.',
    width: 7, height: 5,
    floor: Array.from({ length: 7 }, (_, x) => [x, 2]),
    start: { x: 0, y: 2, dir: 0 }, goal: { x: 6, y: 2 },
    gates: [{ x: 3, y: 2, period: 4, open: [0, 1] }],
    base: [...'FFFFFFFW'],
  },
  {
    id: 1, title: 'Wrong turn',
    brief: 'The track turns north. Replace one instruction to follow it home.',
    width: 7, height: 5,
    floor: [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [4, 1], [5, 1], [6, 1]],
    start: { x: 0, y: 3, dir: 0 }, goal: { x: 6, y: 1 }, gates: [],
    base: [...'FFFRFFRFFF'],
  },
  {
    id: 2, title: 'Two cleanups',
    brief: 'Fix the turn, then fork that fix to reach the gate on an open beat.',
    width: 7, height: 5,
    floor: [[0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]],
    start: { x: 0, y: 2, dir: 0 }, goal: { x: 6, y: 0 },
    gates: [{ x: 5, y: 0, period: 3, open: [0] }],
    base: [...'FFRFFRFFWFF'],
  },
]);

export function gateOpen(gate, tick) {
  return gate.open.includes(((tick % gate.period) + gate.period) % gate.period);
}

export function simulate(level, program) {
  const instructions = [...program];
  if (instructions.some(op => !OPS.has(op))) {
    throw new TypeError('Use only F, L, R, or W instructions.');
  }
  const floor = new Set(level.floor.map(([x, y]) => `${x},${y}`));
  let { x, y, dir } = level.start;
  const states = [{ tick: 0, x, y, dir, status: 'running' }];
  let status = 'unfinished';

  for (let index = 0; index < instructions.length; index++) {
    const tick = index + 1;
    const op = instructions[index];
    let reason;
    if (op === 'F') {
      const [dx, dy] = STEPS[dir];
      const nx = x + dx;
      const ny = y + dy;
      if (!floor.has(`${nx},${ny}`)) {
        reason = `Off the track at (${nx}, ${ny}).`;
      } else if (level.gates.some(gate => gate.x === nx && gate.y === ny && !gateOpen(gate, tick))) {
        reason = `Gate closed on beat ${tick}.`;
      } else {
        x = nx;
        y = ny;
      }
    } else if (op === 'L') {
      dir = (dir + 3) % 4;
    } else if (op === 'R') {
      dir = (dir + 1) % 4;
    }

    const frameStatus = reason ? 'crashed'
      : x === level.goal.x && y === level.goal.y ? 'delivered'
        : index === instructions.length - 1 ? 'unfinished' : 'running';
    states.push({ tick, x, y, dir, status: frameStatus, ...(reason ? { reason } : {}) });
    if (frameStatus === 'crashed' || frameStatus === 'delivered') {
      status = frameStatus;
      break;
    }
  }

  return { states, status, finishTick: states.at(-1).tick, program: instructions };
}

export function firstDifference(a, b) {
  const left = Array.isArray(a) ? a : a.states;
  const right = Array.isArray(b) ? b : b.states;
  if (!left.length || !right.length) throw new TypeError('Compare two recorded runs.');
  const lastTick = Math.max(left.at(-1).tick, right.at(-1).tick);
  let li = 0;
  let ri = 0;
  for (let tick = 0; tick <= lastTick; tick++) {
    while (li + 1 < left.length && left[li + 1].tick <= tick) li++;
    while (ri + 1 < right.length && right[ri + 1].tick <= tick) ri++;
    if (['x', 'y', 'dir', 'status'].some(key => left[li][key] !== right[ri][key])) return tick;
  }
  return null;
}

function decodeTag(value) {
  const escapes = { s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' };
  return value.replace(/\\(.)|\\$/g, (_, escaped) => escaped === undefined ? '' : escapes[escaped] ?? escaped);
}

export function parseIRC(line) {
  if (typeof line !== 'string') return null;
  let rest = line.replace(/\r?\n$/, '');
  if (!rest || /[\0\r\n]/.test(rest) || rest.startsWith(' ')) return null;
  const tags = {};

  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ');
    if (space < 2) return null;
    for (const tag of rest.slice(1, space).split(';')) {
      const equals = tag.indexOf('=');
      const key = equals < 0 ? tag : tag.slice(0, equals);
      if (!/^\+?(?:[A-Za-z0-9.-]+\/)?[A-Za-z0-9-]+$/.test(key)) return null;
      Object.defineProperty(tags, key, {
        value: equals < 0 ? '' : decodeTag(tag.slice(equals + 1)),
        enumerable: true, configurable: true, writable: true,
      });
    }
    rest = rest.slice(space).replace(/^ +/, '');
  }

  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ');
    if (space < 2 || /[\x00-\x20]/.test(rest.slice(1, space))) return null;
    rest = rest.slice(space).replace(/^ +/, '');
  }

  const match = /^([A-Za-z]+|[0-9]{3})(?: +|$)/.exec(rest);
  if (!match) return null;
  const command = match[1].toUpperCase();
  rest = rest.slice(match[0].length);
  const params = [];
  let trailing = null;
  while (rest) {
    if (rest.startsWith(':')) {
      trailing = rest.slice(1);
      break;
    }
    const space = rest.indexOf(' ');
    const param = space < 0 ? rest : rest.slice(0, space);
    if (!param || /[\x00-\x20]/.test(param)) return null;
    params.push(param);
    rest = space < 0 ? '' : rest.slice(space).replace(/^ +/, '');
  }
  if (params.length + (trailing === null ? 0 : 1) > 15) return null;
  if (command === 'PRIVMSG') {
    if (trailing === null && params.length === 2) trailing = params.pop();
    if (params.length !== 1 || !trailing) return null;
  }
  return { command, params, trailing, tags };
}

export function parseFix(text) {
  if (typeof text !== 'string' || /[\r\n]/.test(text)) return null;
  const match = /^[ \t]*!fix[ \t]+([0-9]{1,3})[ \t]+([0-9]{1,2})[ \t]+([FLRW])[ \t]*$/i.exec(text);
  if (!match) return null;
  const parentId = Number(match[1]);
  const slot = Number(match[2]);
  return slot >= 1 && slot <= 16 ? { parentId, slot, op: match[3].toUpperCase() } : null;
}

export function createRound(level) {
  const base = freeze({
    id: 0, parentId: null, slot: null, op: null,
    author: { name: 'Original', id: 'forkline' },
    program: [...level.base], run: simulate(level, level.base),
    messageId: null, source: 'base',
  });
  return { level, records: new Map([[0, base]]), messageIds: new Map(), nextId: 1 };
}

export function addFork(round, { parentId, slot, op, author, messageId, source = 'local' }) {
  const fail = error => ({ ok: false, error });
  if (typeof messageId !== 'string' || !messageId.trim()) return fail('Provide a message ID.');
  if (round.messageIds.has(messageId)) {
    return { ok: true, record: round.records.get(round.messageIds.get(messageId)), duplicate: true };
  }
  if (!Number.isInteger(parentId) || parentId < 0 || parentId > 999 || !round.records.has(parentId)) {
    return fail('Choose an existing parent fork.');
  }
  const parent = round.records.get(parentId);
  if (!Number.isInteger(slot) || slot < 1 || slot > 16 || slot > parent.program.length) {
    return fail(`Choose a slot from 1 to ${Math.min(16, parent.program.length)}.`);
  }
  if (typeof op !== 'string' || !OPS.has(op.toUpperCase())) return fail('Use F, L, R, or W.');
  op = op.toUpperCase();
  if (parent.program[slot - 1] === op) return fail('Choose a different instruction for that slot.');
  if (!author || typeof author.id !== 'string' || !author.id.trim()
    || typeof author.name !== 'string' || !author.name.trim()) {
    return fail('Provide the sender ID and name.');
  }
  if (round.records.size >= 128) return fail('Round is full. Start a new round.');
  const program = [...parent.program];
  program[slot - 1] = op;
  const record = freeze({
    id: round.nextId++, parentId, slot, op,
    author: { id: author.id, name: author.name },
    program, run: simulate(round.level, program), messageId, source,
  });
  round.records.set(record.id, record);
  round.messageIds.set(messageId, record.id);
  return { ok: true, record };
}
