import assert from 'node:assert/strict';
import { LEVELS, simulate, gateOpen, firstDifference, parseIRC, parseFix, createRound, addFork } from './core.mjs';

const changed = (program, slot, op) => program.map((value, index) => index === slot - 1 ? op : value);
const originals = LEVELS.map(level => simulate(level, level.base));
assert.deepEqual(originals.map(run => [run.status, run.finishTick]), [
  ['crashed', 3], ['crashed', 5], ['crashed', 4],
]);
assert.ok(originals.every(run => run.states[0].tick === 0 && run.states[0].status === 'running'));

const firstFix = simulate(LEVELS[0], changed(LEVELS[0].base, 1, 'W'));
const turnFix = simulate(LEVELS[1], changed(LEVELS[1].base, 4, 'L'));
assert.deepEqual([firstFix.status, firstFix.finishTick], ['delivered', 7]);
assert.deepEqual([turnFix.status, turnFix.finishTick], ['delivered', 10]);
assert.equal(firstDifference(originals[0], firstFix), 1);
assert.equal(firstDifference(originals[1], turnFix), 4);
assert.equal(gateOpen(LEVELS[0].gates[0], 4), true);
assert.equal(gateOpen(LEVELS[0].gates[0], 3), false);
assert.equal(simulate(LEVELS[0], ['F']).status, 'unfinished');
assert.equal(simulate(LEVELS[0], []).finishTick, 0);

// A changed, unexecuted instruction has no observable effect.
const noEffect = simulate(LEVELS[0], changed(LEVELS[0].base, 8, 'L'));
assert.equal(firstDifference(originals[0], noEffect), null);
const frozenTail = { states: [...originals[0].states, { ...originals[0].states.at(-1), tick: 7 }] };
assert.equal(firstDifference(originals[0], frozenTail), null);

// Synthetic fixture in Twitch's native IRCv3 wire format: user-id and id are sender/message identity.
const messageId = 'a4fbab08-53d3-4f73-b415-9d506e58814e';
const irc = parseIRC(`@badge-info=;badges=;display-name=Sky\\sFox;id=${messageId};user-id=424242;note=one\\:two\\\\three\\r\\n :skyfox!skyfox@skyfox.tmi.twitch.tv PRIVMSG #forkline :!fix 0 1 w\r\n`);
assert.equal(irc.command, 'PRIVMSG');
assert.deepEqual(irc.params, ['#forkline']);
assert.equal(irc.tags['user-id'], '424242');
assert.equal(irc.tags.id, messageId);
assert.equal(irc.tags['display-name'], 'Sky Fox');
assert.equal(irc.tags.note, 'one;two\\three\r\n');
assert.deepEqual(parseFix(irc.trailing), { parentId: 0, slot: 1, op: 'W' });
assert.deepEqual(parseIRC('PING :tmi.twitch.tv'), { command: 'PING', params: [], trailing: 'tmi.twitch.tv', tags: {} });
for (const line of ['', '@id=missing-command', ':missing-command', '@;bad=tag PRIVMSG #forkline :x',
  'PRIVMSG', 'PRIVMSG #forkline :', 'PRIVMSG #forkline :x\r\nPRIVMSG #forkline :y']) {
  assert.equal(parseIRC(line), null, line);
}
for (const text of ['!fix 1junk 1 W', '!fix 1.0 1 W', '!fix 0 1.0 W', '!fix -1 1 W',
  '!fix 1000 1 W', '!fix 0 0 W', '!fix 0 17 W', '!fix 0 1 FF', '!fix 0 1 X',
  '!fix 0 1 W extra', '!fix 0 1 W\n']) {
  assert.equal(parseFix(text), null, text);
}
assert.deepEqual(parseFix('!FIX 999 16 r'), { parentId: 999, slot: 16, op: 'R' });

const round = createRound(LEVELS[0]);
const base = round.records.get(0);
assert.deepEqual(base.author, { name: 'Original', id: 'forkline' });
assert.throws(() => { base.program[0] = 'W'; }, TypeError);
assert.throws(() => { base.author.name = 'Someone else'; }, TypeError);
const request = {
  ...parseFix(irc.trailing), author: { id: irc.tags['user-id'], name: irc.tags['display-name'] },
  messageId: irc.tags.id, source: 'twitch',
};
const fork = addFork(round, request);
assert.equal(fork.ok, true);
assert.equal(fork.record.run.status, 'delivered');
assert.equal(fork.record.program.filter((op, index) => op !== base.program[index]).length, 1);
assert.deepEqual(fork.record.author, { id: '424242', name: 'Sky Fox' });
assert.equal(fork.record.parentId, 0);
const nextId = round.nextId;
const duplicate = addFork(round, { ...request, parentId: 999 });
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.record, fork.record);
assert.equal(round.nextId, nextId);
assert.equal(round.records.size, 2);
for (const alteration of [{ parentId: 999 }, { slot: 9 }, { slot: 1.5 }, { op: 'F' },
  { op: 'FF' }, { messageId: '' }, { author: { name: 'Anonymous' } }]) {
  assert.equal(addFork(round, { ...request, messageId: 'invalid-new-id', ...alteration }).ok, false);
}
assert.equal(round.records.size, 2);

const chain = createRound(LEVELS[2]);
const ada = addFork(chain, { parentId: 0, slot: 3, op: 'L', author: { id: '111', name: 'Ada' }, messageId: 'ada-1', source: 'demo' });
assert.equal(ada.ok, true);
assert.deepEqual([ada.record.run.status, ada.record.run.finishTick], ['crashed', 10]);
assert.match(ada.record.run.states.at(-1).reason, /Gate closed/);
const lin = addFork(chain, { parentId: ada.record.id, slot: 9, op: 'F', author: { id: '222', name: 'Lin' }, messageId: 'lin-1', source: 'demo' });
assert.equal(lin.ok, true);
assert.deepEqual([lin.record.run.status, lin.record.run.finishTick], ['delivered', 10]);
assert.equal(lin.record.parentId, ada.record.id);
assert.equal(firstDifference(chain.records.get(0).run, ada.record.run), 3);
assert.equal(firstDifference(ada.record.run, lin.record.run), 9);
assert.equal(gateOpen(LEVELS[2].gates[0], 9), true);
assert.equal(gateOpen(LEVELS[2].gates[0], 10), false);

const full = createRound(LEVELS[0]);
for (let index = 1; index < 128; index++) {
  assert.equal(addFork(full, { parentId: 0, slot: 8, op: 'L', author: { id: '333', name: 'Remixer' }, messageId: `limit-${index}` }).ok, true);
}
assert.equal(full.records.size, 128);
assert.equal(addFork(full, { ...request, messageId: 'over-limit' }).ok, false);
assert.equal(addFork(full, { messageId: 'limit-1' }).duplicate, true);
assert.equal(full.records.size, 128);

console.log('Forkline core checks passed: 3 levels, causal forks, IRC identity, strict commands, replay dedupe, frozen tails, 128-record cap.');
